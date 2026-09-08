import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  runReindexCycle,
  type ReindexCyclePorts,
  type ReindexSnapshot,
  type CommitEmbeddingResult,
} from "@/lib/ai/reindex-coordinator";
import { computeContentFingerprint } from "@/lib/ai/embedding-fingerprint";

/** Cheap, deterministic stand-in for computeContentFingerprint — most tests don't need real SHA-256, just something that changes when title/content changes. */
function fingerprintOf(snapshot: Pick<ReindexSnapshot, "title" | "content">): string {
  return `${snapshot.title}::${snapshot.content}`;
}

interface FakePortsOptions {
  /**
   * What loadNote() returns on each successive call, in order. The
   * last entry repeats for any calls beyond the array's length. This
   * is how each test controls what the note "looks like" at each point
   * the coordinator re-reads it (initial read, and any reload after a
   * database-reported "superseded" result).
   */
  noteSequence: (ReindexSnapshot | null)[];
  isTooLarge?: (snapshot: Pick<ReindexSnapshot, "title" | "content">) => boolean;
  isAlreadyCurrent?: (fingerprint: string) => boolean;
  generateEmbeddingShouldFail?: boolean;
  /**
   * What commitEmbedding() returns on each successive call, in order.
   * Defaults to always "committed" unless `writeShouldFail` is set (in
   * which case every call returns an "error" result instead). This is
   * how tests simulate the database rejecting a write as superseded —
   * the actual behavior under test.
   */
  commitSequence?: CommitEmbeddingResult["status"][];
  writeShouldFail?: boolean;
  /** What confirmReady() returns on each successive call, in order. Defaults to always true. */
  confirmReadySequence?: boolean[];
}

interface FakePorts extends ReindexCyclePorts {
  calls: {
    loadNote: number;
    generateEmbedding: ReindexSnapshot[];
    commitEmbedding: { version: unknown; fingerprint: string }[];
    confirmReady: unknown[];
    setStatus: string[];
    clearEmbedding: number;
  };
}

function makeFakePorts(options: FakePortsOptions): FakePorts {
  const calls: FakePorts["calls"] = {
    loadNote: 0,
    generateEmbedding: [],
    commitEmbedding: [],
    confirmReady: [],
    setStatus: [],
    clearEmbedding: 0,
  };

  return {
    calls,

    loadNote: async () => {
      const index = calls.loadNote;
      calls.loadNote += 1;
      const sequence = options.noteSequence;
      return index < sequence.length ? sequence[index] : sequence[sequence.length - 1];
    },

    isTooLarge: options.isTooLarge ?? (() => false),

    computeFingerprint: fingerprintOf,

    isAlreadyCurrent: async (fingerprint) => options.isAlreadyCurrent?.(fingerprint) ?? false,

    generateEmbedding: async (snapshot) => {
      calls.generateEmbedding.push({ ...snapshot, version: undefined });
      if (options.generateEmbeddingShouldFail) {
        throw new Error("Provider exploded.");
      }
      return [1, 2, 3];
    },

    commitEmbedding: async (version, fingerprint) => {
      const index = calls.commitEmbedding.length;
      calls.commitEmbedding.push({ version, fingerprint });

      if (options.writeShouldFail) {
        return { status: "error", error: "Couldn't save the semantic index for this note." };
      }

      const sequence = options.commitSequence;
      const status = sequence
        ? index < sequence.length
          ? sequence[index]
          : sequence[sequence.length - 1]
        : "committed";

      if (status === "error") {
        return { status: "error", error: "Couldn't save the semantic index for this note." };
      }
      return { status };
    },

    confirmReady: async (version) => {
      const index = calls.confirmReady.length;
      calls.confirmReady.push(version);
      const sequence = options.confirmReadySequence;
      return sequence ? (index < sequence.length ? sequence[index] : sequence[sequence.length - 1]) : true;
    },

    clearEmbedding: async () => {
      calls.clearEmbedding += 1;
    },

    setStatus: async (status) => {
      calls.setStatus.push(status);
    },
  };
}

const versionA: ReindexSnapshot = { title: "Trip planning", content: "Version A content", version: 1 };
const versionB: ReindexSnapshot = { title: "Trip planning", content: "Version B content", version: 2 };
const versionC: ReindexSnapshot = { title: "Trip planning", content: "Version C content", version: 3 };

describe("runReindexCycle — happy path", () => {
  test("embeds and commits when nothing changes underneath it", async () => {
    const ports = makeFakePorts({ noteSequence: [versionA] });

    const outcome = await runReindexCycle(ports);

    assert.deepEqual(ports.calls.generateEmbedding, [{ ...versionA, version: undefined }]);
    assert.deepEqual(ports.calls.commitEmbedding, [{ version: 1, fingerprint: fingerprintOf(versionA) }]);
    // 'ready' is never set via the plain setStatus port — commitEmbedding
    // itself marks the note ready, atomically, as part of the same
    // database operation as the vector write.
    assert.equal(ports.calls.setStatus.length, 0);
    assert.equal(outcome.status, "ready");
  });

  test("same unchanged note does not generate a duplicate embedding, and confirms ready atomically", async () => {
    const ports = makeFakePorts({
      noteSequence: [versionA],
      isAlreadyCurrent: () => true,
    });

    const outcome = await runReindexCycle(ports);

    assert.equal(ports.calls.generateEmbedding.length, 0);
    assert.equal(ports.calls.commitEmbedding.length, 0);
    assert.deepEqual(ports.calls.confirmReady, [1]);
    assert.equal(ports.calls.setStatus.length, 0);
    assert.equal(outcome.status, "skipped");
  });

  test("force bypasses the already-current skip check", async () => {
    const ports = makeFakePorts({
      noteSequence: [versionA],
      isAlreadyCurrent: () => true, // would normally skip
    });

    const outcome = await runReindexCycle(ports, { force: true });

    assert.deepEqual(ports.calls.generateEmbedding, [{ ...versionA, version: undefined }]);
    assert.equal(outcome.status, "ready");
  });
});

describe("runReindexCycle — the write-order race (older embedding must never win)", () => {
  test("Scenario 1/2: database rejects a stale commit as superseded, coordinator re-embeds the current version", async () => {
    // A is loaded and embedded. By the time commitEmbedding reaches the
    // database, a concurrent Version B save has already landed and
    // moved content_version on — exactly the race an application-level
    // pre-write check can't close (the check and the write are the
    // same atomic operation here, so this is what "rejected at the
    // database boundary" looks like from the coordinator's side).
    const ports = makeFakePorts({
      noteSequence: [versionA, versionB],
      commitSequence: ["superseded", "committed"],
    });

    const outcome = await runReindexCycle(ports);

    assert.deepEqual(ports.calls.generateEmbedding, [
      { ...versionA, version: undefined },
      { ...versionB, version: undefined },
    ]);
    // A's embedding is attempted and rejected; only B's is ever accepted.
    assert.deepEqual(ports.calls.commitEmbedding, [
      { version: 1, fingerprint: fingerprintOf(versionA) },
      { version: 2, fingerprint: fingerprintOf(versionB) },
    ]);
    assert.equal(outcome.status, "ready");
    if (outcome.status === "ready") {
      assert.equal(outcome.fingerprint, fingerprintOf(versionB));
    }
    // At no point does the coordinator itself flip the status to
    // 'ready' — that happened inside the successful commit only.
    assert.equal(ports.calls.setStatus.length, 0);
  });

  test("Scenario 3: an older job's late commit can never overwrite a newer, already-committed version", async () => {
    // Modeled directly at the port boundary: A's commit call reaches
    // the database after B's already succeeded. The fake's database
    // stand-in reports "superseded" for A regardless of when the call
    // was *issued*, because that's what the real content_version check
    // would find — content_version has already moved past A's expected
    // version. The coordinator must not treat this as some other kind
    // of failure; it must discard A and pick up whatever's current.
    const ports = makeFakePorts({
      noteSequence: [versionA, versionB],
      commitSequence: ["superseded", "committed"],
    });

    const outcome = await runReindexCycle(ports);

    assert.equal(outcome.status, "ready");
    if (outcome.status === "ready") {
      assert.equal(outcome.fingerprint, fingerprintOf(versionB));
    }
  });

  test("Scenario 4: rapid A -> B -> C edits converge on C, never an intermediate version", async () => {
    const ports = makeFakePorts({
      noteSequence: [versionA, versionB, versionC],
      commitSequence: ["superseded", "superseded", "committed"],
    });

    const outcome = await runReindexCycle(ports);

    assert.deepEqual(ports.calls.generateEmbedding.map((s) => s.content), [
      versionA.content,
      versionB.content,
      versionC.content,
    ]);
    assert.deepEqual(
      ports.calls.commitEmbedding.map((c) => c.fingerprint),
      [fingerprintOf(versionA), fingerprintOf(versionB), fingerprintOf(versionC)],
    );
    assert.equal(outcome.status, "ready");
    if (outcome.status === "ready") {
      assert.equal(outcome.fingerprint, fingerprintOf(versionC));
    }
  });

  test("the already-current skip path is also rejected atomically when superseded mid-check", async () => {
    // isAlreadyCurrent(fingerprint) said A's stored embedding still
    // matches — but confirmReady's underlying database check finds the
    // note has already moved to B by the time it runs. The coordinator
    // must not report 'skipped'/'ready' for A; it must reload and
    // re-evaluate B (which, here, still needs a real embed).
    const ports = makeFakePorts({
      noteSequence: [versionA, versionB],
      isAlreadyCurrent: (fingerprint) => fingerprint === fingerprintOf(versionA),
      confirmReadySequence: [false],
    });

    const outcome = await runReindexCycle(ports);

    assert.deepEqual(ports.calls.confirmReady, [1]);
    // Fell through to a real embed + commit for B.
    assert.deepEqual(ports.calls.generateEmbedding.map((s) => s.content), [versionB.content]);
    assert.deepEqual(ports.calls.commitEmbedding, [{ version: 2, fingerprint: fingerprintOf(versionB) }]);
    assert.equal(outcome.status, "ready");
  });

  test("never reports ready for content that isn't what was just committed", async () => {
    // Regression guard for the exact bug described in the Phase 7.2
    // report: content B + embedding A + status ready must never happen.
    const ports = makeFakePorts({
      noteSequence: [versionA, versionB],
      commitSequence: ["superseded", "committed"],
    });
    const outcome = await runReindexCycle(ports);

    assert.equal(outcome.status, "ready");
    if (outcome.status === "ready") {
      assert.equal(outcome.fingerprint, fingerprintOf(versionB));
    }
    // Exactly one commit call ever succeeded, and it was B's.
    const committedCalls = ports.calls.commitEmbedding.filter(
      (_, i) => i === ports.calls.commitEmbedding.length - 1,
    );
    assert.equal(committedCalls.length, 1);
    assert.equal(committedCalls[0].fingerprint, fingerprintOf(versionB));
  });
});

describe("runReindexCycle — note becomes empty or too large mid-flight", () => {
  test("clears the embedding and marks pending when the note is empty from the start", async () => {
    const empty: ReindexSnapshot = { title: "", content: "", version: 1 };
    const ports = makeFakePorts({ noteSequence: [empty] });

    const outcome = await runReindexCycle(ports);

    assert.equal(ports.calls.clearEmbedding, 1);
    assert.deepEqual(ports.calls.setStatus, ["pending"]);
    assert.equal(ports.calls.generateEmbedding.length, 0);
    assert.equal(outcome.status, "empty");
  });

  test("becomes empty mid-flight after a superseded commit (content cleared while embedding was running)", async () => {
    const empty: ReindexSnapshot = { title: "", content: "", version: 2 };
    const ports = makeFakePorts({
      noteSequence: [versionA, empty],
      commitSequence: ["superseded"],
    });

    const outcome = await runReindexCycle(ports);

    assert.deepEqual(ports.calls.generateEmbedding.map((s) => s.content), [versionA.content]);
    assert.equal(ports.calls.clearEmbedding, 1);
    assert.deepEqual(ports.calls.setStatus, ["pending"]);
    assert.equal(outcome.status, "empty");
  });

  test("marks stale (not failed) and skips embedding when content is too large", async () => {
    const ports = makeFakePorts({ noteSequence: [versionA], isTooLarge: () => true });

    const outcome = await runReindexCycle(ports);

    assert.deepEqual(ports.calls.setStatus, ["stale"]);
    assert.equal(ports.calls.generateEmbedding.length, 0);
    assert.equal(outcome.status, "too_large");
  });
});

describe("runReindexCycle — provider/commit failures", () => {
  test("marks failed when the provider errors and the note hasn't changed since", async () => {
    const ports = makeFakePorts({
      noteSequence: [versionA, versionA], // top-of-loop read, then the isStillCurrentVersion re-check
      generateEmbeddingShouldFail: true,
    });

    const outcome = await runReindexCycle(ports);

    assert.deepEqual(ports.calls.setStatus, ["failed"]);
    assert.equal(outcome.status, "failed");
  });

  test("does not mark failed when the note already moved on before the failure was handled", async () => {
    const ports = makeFakePorts({
      noteSequence: [versionA, versionB], // moved to B before we got to report A's failure
      generateEmbeddingShouldFail: true,
    });

    const outcome = await runReindexCycle(ports);

    assert.equal(ports.calls.setStatus.length, 0);
    assert.equal(outcome.status, "failed");
  });

  test("marks failed when the commit errors (e.g. a real database error) and the note hasn't changed since", async () => {
    const ports = makeFakePorts({
      noteSequence: [versionA, versionA],
      writeShouldFail: true,
    });

    const outcome = await runReindexCycle(ports);

    assert.deepEqual(ports.calls.setStatus, ["failed"]);
    assert.equal(outcome.status, "failed");
  });

  test("does not mark failed on a commit error if the note already moved on", async () => {
    const ports = makeFakePorts({
      noteSequence: [versionA, versionB],
      writeShouldFail: true,
    });

    const outcome = await runReindexCycle(ports);

    assert.equal(ports.calls.setStatus.length, 0);
    assert.equal(outcome.status, "failed");
  });
});

describe("runReindexCycle — not found", () => {
  test("returns not_found immediately when the note doesn't exist", async () => {
    const ports = makeFakePorts({ noteSequence: [null] });

    const outcome = await runReindexCycle(ports);

    assert.equal(outcome.status, "not_found");
    assert.equal(ports.calls.generateEmbedding.length, 0);
  });

  test("returns not_found when the note is deleted while the embedding was being generated", async () => {
    const ports = makeFakePorts({
      noteSequence: [versionA, null],
      commitSequence: ["superseded"],
    });

    const outcome = await runReindexCycle(ports);

    assert.deepEqual(ports.calls.generateEmbedding.map((s) => s.content), [versionA.content]);
    assert.equal(outcome.status, "not_found");
  });
});

describe("runReindexCycle — sanity check against the real fingerprint function", () => {
  test("works end-to-end with computeContentFingerprint instead of the test stand-in", async () => {
    const a: ReindexSnapshot = { title: "Real note", content: "Real content A", version: 1 };
    const b: ReindexSnapshot = { title: "Real note", content: "Real content B", version: 2 };

    let commitCall = 0;
    const ports: ReindexCyclePorts = {
      loadNote: (() => {
        let call = 0;
        return async () => {
          call += 1;
          return call === 1 ? a : b;
        };
      })(),
      isTooLarge: () => false,
      computeFingerprint: ({ title, content }) => computeContentFingerprint(title, content),
      isAlreadyCurrent: async () => false,
      generateEmbedding: async () => [0.1, 0.2],
      commitEmbedding: async (version) => {
        commitCall += 1;
        // First attempt (for A, expected version 1) is superseded, since
        // by the time this "reaches the database" the note is already
        // at version 2 (B).
        return commitCall === 1 && version === a.version ? { status: "superseded" } : { status: "committed" };
      },
      confirmReady: async () => true,
      clearEmbedding: async () => {},
      setStatus: async () => {},
    };

    const outcome = await runReindexCycle(ports);
    assert.equal(outcome.status, "ready");
    if (outcome.status === "ready") {
      assert.equal(outcome.fingerprint, computeContentFingerprint(b.title, b.content));
    }
  });
});
