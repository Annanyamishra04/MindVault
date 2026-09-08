/**
 * Pure coordination logic for note embedding reindexes (Phase 7.2).
 *
 * Phase 7 had a race: reindexNoteEmbedding() computed a content
 * fingerprint, awaited a slow Gemini call, then unconditionally upserted
 * the resulting vector and marked embedding_status = 'ready'. If the
 * note was saved again (a newer version) while that Gemini call was
 * still running, the older embedding could finish afterward and mark
 * 'ready' over a newer, un-embedded version.
 *
 * Phase 7.1 narrowed the window by reloading the note immediately
 * before writing and comparing fingerprints in application code. That
 * closed most of the gap, but not all of it: there is always a possible
 * database write between "check current fingerprint" (in JS) and
 * "write embedding / set ready" (a separate later statement). Two
 * concurrent processes can both pass the JS check, and whichever writes
 * second still wins — the exact bug this module now fixes.
 *
 * The Phase 7.2 fix: the write itself is no longer two things ("upsert
 * the vector", "mark ready" as separate statements) with a check in
 * front of them in memory. It is a single atomic port,
 * `commitEmbedding`, backed by a Postgres function
 * (commit_note_embedding, see migration 0008) that re-verifies the
 * note's content_version against the expected version *inside the same
 * locked transaction* as the vector upsert and the embedding_status
 * update. If a newer save landed first, content_version has already
 * moved on and the commit is rejected atomically — there is no window
 * between the check and the write for another process to land in,
 * because the check and the write are the same database operation. The
 * "already current, just refresh the status flag" skip path gets the
 * same treatment via `confirmReady`, for the same reason: a plain
 * `UPDATE notes SET embedding_status = 'ready' WHERE id = ...` with no
 * version guard would reopen exactly this race for notes that happen to
 * skip re-embedding.
 *
 * This module stays free of any Supabase/Gemini/Next.js import so it
 * can be unit tested directly (see reindex-coordinator.test.ts) by
 * supplying fake ports that simulate both "the note changed mid-flight"
 * and "the database rejected this commit as superseded". The real
 * adapter lives in lib/ai/embeddings.ts::performReindex, which wires
 * these ports to the actual database and AI provider.
 */

export interface ReindexSnapshot {
  title: string;
  content: string;
  /**
   * Opaque token identifying exactly this persisted title/content pair
   * (in practice, notes.content_version — see migration 0008). This
   * module never inspects or compares it directly; it only carries it
   * from loadNote() through to commitEmbedding()/confirmReady() so the
   * database can enforce, inside one transaction, that nothing changed
   * the note since this snapshot was read. Keeping it opaque here is
   * deliberate: this module should not need its own idea of what
   * "unchanged" means (a fingerprint, a version int, a timestamp, ...)
   * — that decision belongs entirely to the adapter/database.
   */
  version: unknown;
}

export type ReindexCycleOutcome =
  | { status: "ready"; fingerprint: string }
  | { status: "skipped"; fingerprint: string } // stored embedding already matched current content + model
  | { status: "empty" } // note has no content to index
  | { status: "too_large" } // title+content exceeds the embedding input limit
  | { status: "not_found" } // note no longer exists / isn't visible to the caller
  | { status: "failed"; error: string };

export type CommitEmbeddingResult =
  | { status: "committed" }
  /**
   * The database rejected this write: the note's persisted version no
   * longer matches the version this embedding was generated from (a
   * newer save landed while the embedding was in flight, or an even
   * later commit already won). The embedding just computed must be
   * discarded — never retried against the same version.
   */
  | { status: "superseded" }
  | { status: "error"; error: string };

export interface ReindexCyclePorts {
  /**
   * Loads the note's current persisted title/content/version, or null
   * if it no longer exists (or isn't visible to the caller, e.g.
   * RLS/deleted).
   */
  loadNote: () => Promise<ReindexSnapshot | null>;
  /** True if title+content together are too large to embed. */
  isTooLarge: (snapshot: Pick<ReindexSnapshot, "title" | "content">) => boolean;
  /** Deterministic fingerprint of exactly what would be embedded. */
  computeFingerprint: (snapshot: Pick<ReindexSnapshot, "title" | "content">) => string;
  /**
   * True if a stored embedding already matches `fingerprint` and the
   * currently configured model/dimensions — i.e. it's safe to skip
   * calling the provider again. Only consulted when `force` is false.
   */
  isAlreadyCurrent: (fingerprint: string) => Promise<boolean>;
  /** Calls the embedding provider for this exact snapshot. May reject. */
  generateEmbedding: (snapshot: Pick<ReindexSnapshot, "title" | "content">) => Promise<number[]>;
  /**
   * Atomically persists the vector + fingerprint and marks the note
   * 'ready' — but ONLY if the note's current persisted version still
   * equals `version`. This is the actual race fix: the freshness check
   * and the write happen as one database operation, not a JS check
   * followed by a separate write. Must never partially apply (no vector
   * written without 'ready', no 'ready' without the matching vector).
   */
  commitEmbedding: (
    version: unknown,
    fingerprint: string,
    embedding: number[],
  ) => Promise<CommitEmbeddingResult>;
  /**
   * Atomically marks the note 'ready' when the already-current check
   * found nothing to re-embed — again, ONLY if the note's current
   * persisted version still equals `version`. Returns false (never
   * throws) when superseded, so the caller can reload and retry for
   * whatever is current instead.
   */
  confirmReady: (version: unknown) => Promise<boolean>;
  /** Removes any stored embedding (the note has no content anymore). */
  clearEmbedding: () => Promise<void>;
  /** Sets notes.embedding_status for terminal non-ready outcomes. */
  setStatus: (status: "stale" | "failed" | "pending") => Promise<void>;
}

/**
 * Runs one note's reindex to convergence. See module docstring for the
 * coordination strategy. `force` bypasses the isAlreadyCurrent skip
 * check on the FIRST attempt only — once the loop discovers a newer
 * version mid-flight, it re-checks that newer version normally (so a
 * concurrent, already-correct embedding for it isn't redundantly
 * regenerated).
 */
export async function runReindexCycle(
  ports: ReindexCyclePorts,
  options: { force?: boolean } = {},
): Promise<ReindexCycleOutcome> {
  let snapshot = await ports.loadNote();
  if (!snapshot) return { status: "not_found" };

  let force = options.force ?? false;

  for (;;) {
    const title = snapshot.title.trim();
    const content = snapshot.content.trim();

    if (!content) {
      // Nothing to index. Clear any embedding left over from before the
      // note was emptied out, so search/related-notes can't keep
      // surfacing a vector for content that no longer exists.
      await ports.clearEmbedding();
      await ports.setStatus("pending");
      return { status: "empty" };
    }

    if (ports.isTooLarge({ title, content })) {
      await ports.setStatus("stale");
      return { status: "too_large" };
    }

    const fingerprint = ports.computeFingerprint({ title, content });

    if (!force) {
      const current = await ports.isAlreadyCurrent(fingerprint);
      if (current) {
        // Already current — just make sure the cheap status flag
        // agrees, in case a previous call marked it 'stale'/'failed'
        // and this one is finding the content ended up back at a
        // previously embedded state (e.g. an edit followed by an
        // undo). Done atomically (confirmReady), not a plain UPDATE:
        // without the version guard, a save landing right here could
        // get its own fresh 'stale' silently flipped back to 'ready'
        // by this call, for content that was never actually
        // (re-)embedded.
        const confirmed = await ports.confirmReady(snapshot.version);
        if (confirmed) {
          return { status: "skipped", fingerprint };
        }
        // Superseded: something changed the note between loadNote()
        // and this confirmReady() call. Reload and retry for whatever
        // is current now.
        const latest = await ports.loadNote();
        if (!latest) return { status: "not_found" };
        snapshot = latest;
        force = false;
        continue;
      }
    }

    let embedding: number[];
    try {
      embedding = await ports.generateEmbedding({ title, content });
    } catch (error) {
      // Only report failure if the version we just failed to embed is
      // STILL the current one. If the note has already moved on again
      // (another save landed while Gemini was running/erroring), that
      // newer version's own reindex is what matters now — clobbering
      // its 'stale' status with 'failed' for content nobody's looking
      // at anymore would be misleading and would hide that a retry is
      // actually still needed for the current content.
      const stillCurrent = await isStillCurrentVersion(ports, fingerprint);
      if (stillCurrent) {
        await ports.setStatus("failed");
      }
      return { status: "failed", error: error instanceof Error ? error.message : "Embedding failed." };
    }

    // The actual race fix: attempt the write and the freshness check as
    // one atomic database operation. There is no JS-memory window
    // between "is this still current" and "write it" for another
    // process's save to land in — see commitEmbedding's port doc and
    // migration 0008's commit_note_embedding().
    const commit = await ports.commitEmbedding(snapshot.version, fingerprint, embedding);

    if (commit.status === "committed") {
      return { status: "ready", fingerprint };
    }

    if (commit.status === "superseded") {
      // A newer save landed before this commit reached the database.
      // The vector we just computed is discarded (never partially
      // applied — commitEmbedding guarantees that) and the loop tries
      // again for whatever is current now, so a newer save can never
      // lose its reindex, and an older embedding can never overwrite a
      // newer one.
      const latest = await ports.loadNote();
      if (!latest) return { status: "not_found" };
      snapshot = latest;
      force = false;
      continue;
    }

    // commit.status === "error"
    const stillCurrent = await isStillCurrentVersion(ports, fingerprint);
    if (stillCurrent) {
      await ports.setStatus("failed");
    }
    return { status: "failed", error: commit.error };
  }
}

async function isStillCurrentVersion(ports: ReindexCyclePorts, fingerprint: string): Promise<boolean> {
  const latest = await ports.loadNote();
  if (!latest) return false;
  const latestFingerprint = ports.computeFingerprint({
    title: latest.title.trim(),
    content: latest.content.trim(),
  });
  return latestFingerprint === fingerprint;
}
