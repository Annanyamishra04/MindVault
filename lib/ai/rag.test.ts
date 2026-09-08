import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildRagSources,
  evaluateGrounding,
  formatSourcesForPrompt,
  truncateForContext,
  validateCitations,
  type RagCandidateRow,
} from "@/lib/ai/rag";

function row(overrides: Partial<RagCandidateRow> = {}): RagCandidateRow {
  return {
    noteId: "note-1",
    title: "Untitled",
    content: "Some content",
    similarity: 0.6,
    ...overrides,
  };
}

describe("truncateForContext", () => {
  test("returns trimmed content unchanged when under the limit", () => {
    const { text, truncated } = truncateForContext("  hello world  ", 100);
    assert.equal(text, "hello world");
    assert.equal(truncated, false);
  });

  test("truncates and marks truncated when over the limit", () => {
    const { text, truncated } = truncateForContext("a".repeat(50), 10);
    assert.equal(text, `${"a".repeat(10)}…`);
    assert.equal(truncated, true);
  });

  test("is deterministic for the same input", () => {
    const a = truncateForContext("some fairly long note content here", 10);
    const b = truncateForContext("some fairly long note content here", 10);
    assert.deepEqual(a, b);
  });
});

describe("buildRagSources", () => {
  test("assigns stable, sequential source IDs in ranked order", () => {
    const rows = [
      row({ noteId: "a", title: "First", similarity: 0.9 }),
      row({ noteId: "b", title: "Second", similarity: 0.7 }),
    ];
    const sources = buildRagSources(rows, {
      maxSources: 5,
      maxTotalChars: 10_000,
      maxCharsPerNote: 1_000,
    });
    assert.deepEqual(
      sources.map((s) => s.id),
      ["S1", "S2"],
    );
    assert.equal(sources[0].noteId, "a");
    assert.equal(sources[1].noteId, "b");
  });

  test("stops at maxSources even if more candidates and budget remain", () => {
    const rows = [row({ noteId: "a" }), row({ noteId: "b" }), row({ noteId: "c" })];
    const sources = buildRagSources(rows, {
      maxSources: 2,
      maxTotalChars: 10_000,
      maxCharsPerNote: 1_000,
    });
    assert.equal(sources.length, 2);
    assert.deepEqual(
      sources.map((s) => s.noteId),
      ["a", "b"],
    );
  });

  test("truncates a single note's content to maxCharsPerNote", () => {
    const rows = [row({ content: "x".repeat(500) })];
    const sources = buildRagSources(rows, {
      maxSources: 5,
      maxTotalChars: 10_000,
      maxCharsPerNote: 50,
    });
    assert.equal(sources[0].content.length, 51); // 50 chars + ellipsis
    assert.equal(sources[0].truncated, true);
  });

  test("does not let one large note consume the entire total budget at the expense of admitting later notes", () => {
    const rows = [
      row({ noteId: "big", content: "x".repeat(9_000) }),
      row({ noteId: "small", content: "small note content" }),
    ];
    const sources = buildRagSources(rows, {
      maxSources: 5,
      maxTotalChars: 10_000,
      maxCharsPerNote: 9_000,
    });
    // The first note is capped by maxCharsPerNote, leaving room for the second.
    assert.equal(sources.length, 2);
    assert.equal(sources[1].noteId, "small");
  });

  test("stops admitting sources once the total character budget is exhausted", () => {
    const rows = [
      row({ noteId: "a", content: "x".repeat(100) }),
      row({ noteId: "b", content: "y".repeat(100) }),
    ];
    const sources = buildRagSources(rows, {
      maxSources: 5,
      maxTotalChars: 100,
      maxCharsPerNote: 100,
    });
    assert.equal(sources.length, 1);
    assert.equal(sources[0].noteId, "a");
  });

  test("skips a candidate with no usable content rather than emitting an empty source", () => {
    const rows = [row({ noteId: "empty", content: "   " }), row({ noteId: "real" })];
    const sources = buildRagSources(rows, {
      maxSources: 5,
      maxTotalChars: 10_000,
      maxCharsPerNote: 1_000,
    });
    assert.deepEqual(
      sources.map((s) => s.noteId),
      ["real"],
    );
  });

  test("returns an empty list for no candidates", () => {
    const sources = buildRagSources([], { maxSources: 5, maxTotalChars: 1000, maxCharsPerNote: 100 });
    assert.deepEqual(sources, []);
  });
});

describe("formatSourcesForPrompt", () => {
  test("renders each source with its label, title, and content", () => {
    const sources = buildRagSources(
      [row({ noteId: "a", title: "My Note", content: "Hello" })],
      { maxSources: 5, maxTotalChars: 1000, maxCharsPerNote: 100 },
    );
    const block = formatSourcesForPrompt(sources);
    assert.match(block, /\[S1\]/);
    assert.match(block, /Title: My Note/);
    assert.match(block, /Hello/);
  });

  test("joins multiple sources with a separator", () => {
    const sources = buildRagSources(
      [row({ noteId: "a", title: "A" }), row({ noteId: "b", title: "B" })],
      { maxSources: 5, maxTotalChars: 1000, maxCharsPerNote: 100 },
    );
    const block = formatSourcesForPrompt(sources);
    const s1Index = block.indexOf("[S1]");
    const s2Index = block.indexOf("[S2]");
    assert.ok(s1Index >= 0 && s2Index > s1Index);
  });
});

describe("validateCitations", () => {
  test("keeps citations whose sourceId is in the valid set", () => {
    const result = validateCitations([{ sourceId: "S1" }, { sourceId: "S2" }], ["S1", "S2"]);
    assert.deepEqual(result, ["S1", "S2"]);
  });

  test("drops a fabricated/invalid sourceId", () => {
    const result = validateCitations([{ sourceId: "S1" }, { sourceId: "S99" }], ["S1", "S2"]);
    assert.deepEqual(result, ["S1"]);
  });

  test("normalizes duplicate citations to a single entry, preserving first-seen order", () => {
    const result = validateCitations(
      [{ sourceId: "S2" }, { sourceId: "S1" }, { sourceId: "S2" }],
      ["S1", "S2"],
    );
    assert.deepEqual(result, ["S2", "S1"]);
  });

  test("handles no citations at all", () => {
    const result = validateCitations([], ["S1", "S2"]);
    assert.deepEqual(result, []);
  });

  test("ignores blank/whitespace-only sourceId values", () => {
    const result = validateCitations([{ sourceId: "   " }, { sourceId: "S1" }], ["S1"]);
    assert.deepEqual(result, ["S1"]);
  });

  test("caps the number of returned citations at RAG_MAX_CITATIONS", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ sourceId: `S${i + 1}` }));
    const validIds = many.map((c) => c.sourceId);
    const result = validateCitations(many, validIds);
    assert.ok(result.length <= 5); // RAG_MAX_CITATIONS === RAG_MAX_SOURCES === 5
  });
});

describe("evaluateGrounding", () => {
  // Phase 8.1: the server-side grounding invariant — an "answered"
  // result must have at least one server-validated citation. These
  // cases mirror the Phase 8.1 spec's required test matrix.

  test("1. valid answer + a valid citation -> grounded, citation retained", () => {
    const result = evaluateGrounding([{ sourceId: "S1" }], ["S1", "S2"]);
    assert.equal(result.grounded, true);
    assert.deepEqual(result.citedIds, ["S1"]);
  });

  test("2. duplicate citations -> grounded, normalized to one entry", () => {
    const result = evaluateGrounding([{ sourceId: "S1" }, { sourceId: "S1" }], ["S1", "S2"]);
    assert.equal(result.grounded, true);
    assert.deepEqual(result.citedIds, ["S1"]);
  });

  test("3. one valid + one fabricated citation -> grounded, fabricated one dropped", () => {
    const result = evaluateGrounding([{ sourceId: "S1" }, { sourceId: "S99" }], ["S1", "S2"]);
    assert.equal(result.grounded, true);
    assert.deepEqual(result.citedIds, ["S1"]);
  });

  test("4. only fabricated citations -> NOT grounded", () => {
    const result = evaluateGrounding([{ sourceId: "S99" }], ["S1", "S2"]);
    assert.equal(result.grounded, false);
    assert.deepEqual(result.citedIds, []);
  });

  test("5. empty citations -> NOT grounded (an unsupported factual answer must not be presented as answered)", () => {
    const result = evaluateGrounding([], ["S1", "S2"]);
    assert.equal(result.grounded, false);
    assert.deepEqual(result.citedIds, []);
  });

  test("no valid sources at all still resolves to not grounded, never throws", () => {
    const result = evaluateGrounding([{ sourceId: "S1" }], []);
    assert.equal(result.grounded, false);
    assert.deepEqual(result.citedIds, []);
  });
});
