import "server-only";

import { getAIProvider, AIProviderError } from "@/lib/ai";
import { getAIErrorMessage } from "@/lib/ai/errors";
import {
  computeContentFingerprint,
  isEmbeddingCurrent,
  isInputTooLargeForEmbedding,
} from "@/lib/ai/embedding-fingerprint";
import { runReindexCycle, type ReindexSnapshot } from "@/lib/ai/reindex-coordinator";
import { MAX_EMBEDDING_INPUT_CHARS } from "@/lib/ai/limits";
import { createClient } from "@/lib/supabase/server";

/**
 * The only module in the app that writes to note_embeddings or reads
 * note content for the purpose of embedding it. Everything here
 * follows the same shape as lib/ai/actions.ts (Phase 6):
 *
 *   -> resolve the authenticated user via supabase.auth.getUser()
 *   -> load the note through the RLS-scoped server client, by id,
 *      scoped to that user — never trust a note id alone
 *   -> never let a Gemini/database failure here throw out to the
 *      caller in a way that could fail a note save (see
 *      reindexNoteEmbedding's callers in lib/notes/actions.ts, which
 *      invoke this from inside `after()`, entirely after the save's
 *      own response has already been sent)
 *
 * See docs/PHASE7_EMBEDDINGS.md for the full staleness/trigger design.
 */

export type ReindexOutcome =
  | { status: "ready" }
  | { status: "skipped" } // stored embedding already matches current content + model
  | { status: "empty" } // note has no content to index
  | { status: "too_large" } // title+content exceeds MAX_EMBEDDING_INPUT_CHARS
  | { status: "not_found" } // note doesn't exist / isn't the caller's / no session
  | { status: "failed"; error: string };

/**
 * Best-effort, single-process de-duplication so two reindex calls for
 * the same note (e.g. a manual "Reindex" click landing while an
 * autosave-triggered reindex from the previous edit is still running)
 * share one in-flight request instead of racing two Gemini calls and
 * two upserts. This is intentionally not a distributed lock — Phase 7
 * explicitly rules out adding queue/worker infrastructure for that —
 * but it covers the common case (a single warm server instance) at
 * zero infrastructure cost. A second reindex request for a note that's
 * genuinely running on a different instance can still race; the
 * upsert below is idempotent (same note_id, last write wins) so that
 * race is harmless, just occasionally redundant.
 */
const inflightReindexes = new Map<string, Promise<ReindexOutcome>>();

/**
 * Ensures note_embeddings has a current vector for `noteId`, generating
 * one only if needed.
 *
 * "Needed" means: no stored embedding exists yet, or the stored one's
 * content_hash/embedding_model/embedding_dimensions don't match the
 * note's current content and the currently configured model (see
 * lib/ai/embedding-fingerprint.ts). Pass `force: true` to bypass that
 * check — used by the user-triggered "Reindex" retry action, since a
 * previous failed attempt may have left an up-to-date content_hash
 * with no actual embedding row to match it, and a stalled provider
 * outage is exactly the case a manual retry exists for.
 */
export async function reindexNoteEmbedding(
  noteId: string,
  options: { force?: boolean } = {},
): Promise<ReindexOutcome> {
  const existing = inflightReindexes.get(noteId);
  if (existing && !options.force) return existing;

  const promise = performReindex(noteId, options).finally(() => {
    // Only clear this note's own in-flight entry — a newer call could
    // have already replaced it (e.g. a force=true retry started while
    // this one was still running).
    if (inflightReindexes.get(noteId) === promise) {
      inflightReindexes.delete(noteId);
    }
  });

  inflightReindexes.set(noteId, promise);
  return promise;
}

/**
 * Adapter between the pure coordination loop (reindex-coordinator.ts)
 * and the real database/AI provider. All the actual freshness/race
 * handling lives in runReindexCycle — this function only wires up how
 * to load a note, check/generate/store an embedding, and set status,
 * then translates its outcome to this module's public ReindexOutcome
 * shape (dropping the internal `fingerprint` field callers don't need).
 *
 * Prior to Phase 7.1 this function did the
 * embed-then-write-then-mark-ready sequence directly, with no re-check
 * that the note hadn't changed while the (slow) embedding call was in
 * flight. Phase 7.1 added a JS-level reload-and-compare right before
 * writing, which helped but still left a gap between that check and
 * the write reaching the database. Phase 7.2 closes that gap by moving
 * the check itself into the database, as part of the same atomic
 * statement as the write — see commitEmbedding/confirmReady below and
 * reindex-coordinator.ts's module docstring for the full history.
 */
async function performReindex(
  noteId: string,
  options: { force?: boolean },
): Promise<ReindexOutcome> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "not_found" };

  const provider = getAIProvider();

  const loadNote = async (): Promise<ReindexSnapshot | null> => {
    const { data: note, error } = await supabase
      .from("notes")
      .select("title, content, content_version")
      .eq("id", noteId)
      .maybeSingle();

    // RLS makes "belongs to someone else" and "doesn't exist" the same
    // outcome here on purpose, same as getNoteById (lib/notes/queries.ts)
    // — and either way, there's nothing to embed.
    if (error || !note) return null;
    return { title: note.title, content: note.content, version: note.content_version };
  };

  const outcome = await runReindexCycle(
    {
      loadNote,

      isTooLarge: ({ title, content }) =>
        // Deliberately not chunking (see README / Phase 7 scope) — a
        // clear "too large" outcome instead of a misleading partial
        // embedding.
        isInputTooLargeForEmbedding(title, content, MAX_EMBEDDING_INPUT_CHARS),

      computeFingerprint: ({ title, content }) => computeContentFingerprint(title, content),

      isAlreadyCurrent: async (fingerprint) => {
        const { data: storedEmbedding } = await supabase
          .from("note_embeddings")
          .select("content_hash, embedding_model, embedding_dimensions")
          .eq("note_id", noteId)
          .maybeSingle();

        return storedEmbedding
          ? isEmbeddingCurrent(
              {
                contentHash: storedEmbedding.content_hash,
                embeddingModel: storedEmbedding.embedding_model,
                embeddingDimensions: storedEmbedding.embedding_dimensions,
              },
              fingerprint,
              { embeddingModel: provider.embeddingModelId, embeddingDimensions: provider.embeddingDimensions },
            )
          : false;
      },

      generateEmbedding: async ({ title, content }) => {
        try {
          return await provider.generateEmbedding(content, "RETRIEVAL_DOCUMENT", title);
        } catch (error) {
          logEmbeddingError("reindexNoteEmbedding", error);
          // Re-thrown as a plain Error with an already-sanitized message
          // — reindex-coordinator.ts is deliberately dependency-free
          // (no lib/ai/errors import) so it stays trivially unit
          // testable, so the safe-message mapping has to happen here,
          // at the boundary, rather than in the coordinator's catch
          // block. Never let a raw provider error/stack reach the
          // client via the coordinator's { status: "failed", error }.
          throw new Error(getAIErrorMessage(error));
        }
      },

      // Phase 7.2: the write and the write-time freshness check happen
      // as one atomic database operation (commit_note_embedding, see
      // migration 0008), not a JS reload-and-compare followed by a
      // separate upsert + status update. See reindex-coordinator.ts's
      // module docstring and commitEmbedding port doc for why the
      // Phase 7.1 approach (reload immediately before writing) still
      // wasn't sufficient.
      commitEmbedding: async (version, fingerprint, embedding) => {
        const { data, error } = await supabase.rpc("commit_note_embedding", {
          p_note_id: noteId,
          p_expected_version: version as number,
          p_content_hash: fingerprint,
          p_embedding: embedding,
          p_embedding_model: provider.embeddingModelId,
          p_embedding_dimensions: provider.embeddingDimensions,
        });

        if (error) {
          logEmbeddingError("reindexNoteEmbedding", error);
          return { status: "error", error: "Couldn't save the semantic index for this note." };
        }
        return data ? { status: "committed" } : { status: "superseded" };
      },

      // Same atomicity requirement as commitEmbedding, for the "stored
      // embedding is already current, just refresh the status flag"
      // path — a plain UPDATE here with no version guard would reopen
      // the exact race being fixed for notes that happen to skip
      // re-embedding (see reindex-coordinator.ts's confirmReady doc).
      confirmReady: async (version) => {
        const { data, error } = await supabase.rpc("confirm_note_embedding_ready", {
          p_note_id: noteId,
          p_expected_version: version as number,
        });

        if (error) {
          logEmbeddingError("reindexNoteEmbedding", error);
          return false;
        }
        return Boolean(data);
      },

      clearEmbedding: async () => {
        await supabase.from("note_embeddings").delete().eq("note_id", noteId);
      },

      setStatus: async (status) => {
        await supabase.from("notes").update({ embedding_status: status }).eq("id", noteId);
      },
    },
    options,
  );

  switch (outcome.status) {
    case "ready":
      return { status: "ready" };
    case "skipped":
      return { status: "skipped" };
    case "empty":
      return { status: "empty" };
    case "too_large":
      return { status: "too_large" };
    case "not_found":
      return { status: "not_found" };
    case "failed":
      return { status: "failed", error: outcome.error };
  }
}

/**
 * Generates a query-side embedding for semantic search / related-notes
 * lookups. Thin wrapper kept here (rather than inlined at each call
 * site) so both lib/ai/actions.ts entry points share one error-mapping
 * path.
 */
export async function generateQueryEmbedding(
  query: string,
): Promise<{ ok: true; embedding: number[] } | { ok: false; error: string }> {
  const provider = getAIProvider();
  try {
    const embedding = await provider.generateEmbedding(query, "RETRIEVAL_QUERY");
    return { ok: true, embedding };
  } catch (error) {
    logEmbeddingError("generateQueryEmbedding", error);
    return { ok: false, error: getAIErrorMessage(error) };
  }
}

/** Same logging convention as lib/ai/actions.ts::logAIError — no secrets, never sent to the client. */
function logEmbeddingError(action: string, error: unknown) {
  if (error instanceof AIProviderError) {
    console.error(`[ai:${action}] provider error (${error.kind}):`, error.message);
  } else if (error instanceof Error) {
    console.error(`[ai:${action}] error:`, error.message);
  } else {
    console.error(`[ai:${action}] unknown error`);
  }
}
