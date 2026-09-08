"use server";

import { getAIProvider, AIProviderError } from "@/lib/ai";
import { getAIErrorMessage } from "@/lib/ai/errors";
import { generateQueryEmbedding, reindexNoteEmbedding } from "@/lib/ai/embeddings";
import {
  computeContentFingerprint,
  isEmbeddingCurrent,
  isInputTooLargeForEmbedding,
} from "@/lib/ai/embedding-fingerprint";
import { MAX_AI_INPUT_CHARS, MAX_EMBEDDING_INPUT_CHARS } from "@/lib/ai/limits";
import { normalizeKeyPoints, normalizeSuggestedTags, parseJsonResponse } from "@/lib/ai/normalize";
import { normalizeMatches, type NormalizedMatch } from "@/lib/ai/semantic-normalize";
import {
  summarizePrompt,
  keyPointsPrompt,
  generateTagsPrompt,
  rewritePrompt,
} from "@/lib/ai/prompts";
import {
  aiSummaryResultSchema,
  aiKeyPointsResultSchema,
  aiTagsResultSchema,
  aiRewriteResultSchema,
  rewriteModeSchema,
  semanticQuerySchema,
  type RewriteMode,
} from "@/lib/ai/schemas";
import { getNoteById } from "@/lib/notes/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Every AI action in this file follows the architecture required for
 * Phase 6:
 *
 *   Client UI
 *     -> Server Action (this file), given only a note id (+ a rewrite
 *        mode where relevant) — never note content from the browser
 *     -> getNoteById() resolves the authenticated user via
 *        supabase.auth.getUser() and loads the note through the
 *        RLS-scoped server client (lib/supabase/server.ts)
 *     -> if the note doesn't come back (wrong owner or doesn't exist —
 *        indistinguishable on purpose, see lib/notes/queries.ts),
 *        return a safe "not found" result, never call Gemini
 *     -> validate/limit the note content
 *     -> call the Gemini provider (lib/ai/gemini.ts) for text only —
 *        no embeddings, no vector search, nothing from lib/ai touches
 *        note_embeddings or pgvector here
 *     -> parse + validate the JSON the model returned against a Zod
 *        schema (lib/ai/schemas.ts) before it's trusted at all
 *     -> return a plain { success, data | error } result — the same
 *        ActionResult convention lib/notes/actions.ts uses, so client
 *        components can show a specific message instead of Next.js's
 *        generic thrown-error fallback
 *
 * A note's *content* is never sent to Gemini until every step above
 * has passed, and a note ID alone (with no session cookie) can never
 * reach Gemini at all — `getNoteById` throws before that point.
 *
 * Nothing here writes an AI result back to the note. Summaries, key
 * points, and tag suggestions are returned for the UI to display; the
 * only path that changes note data is the user explicitly accepting a
 * suggested tag (existing lib/notes/actions.ts::addTagToNote) or
 * applying a rewrite (existing lib/notes/actions.ts::updateNote, called
 * from the client the same way a manual save is).
 */

type AIActionResult<T> = { success: true; data: T } | { success: false; error: string };

/**
 * Loads the note for the current user and returns its content, or a
 * ready-to-return failure result. Centralizes the auth + authorization
 * + size-limit checks shared by every AI action below so each one is
 * just "get content, build a prompt, call Gemini, validate."
 */
async function loadAuthorizedNoteContent(
  noteId: string,
): Promise<{ ok: true; content: string } | { ok: false; result: AIActionResult<never> }> {
  let note: Awaited<ReturnType<typeof getNoteById>>;
  try {
    note = await getNoteById(noteId);
  } catch {
    // getNoteById (via requireUserId) throws when there's no
    // authenticated session at all.
    return {
      ok: false,
      result: { success: false, error: "You need to be signed in to use AI tools." },
    };
  }

  // RLS makes "belongs to another user" and "doesn't exist" the same
  // outcome here on purpose (see getNoteById) — a user changing the
  // note id in a request can never get a different message that would
  // confirm another user's note exists, and can never get its content.
  if (!note) {
    return { ok: false, result: { success: false, error: "Note not found." } };
  }

  const content = note.content.trim();
  if (!content) {
    return {
      ok: false,
      result: {
        success: false,
        error: "Add some content to this note before using AI tools.",
      },
    };
  }

  if (content.length > MAX_AI_INPUT_CHARS) {
    return {
      ok: false,
      result: {
        success: false,
        error: `This note is too long for AI tools right now (limit ${MAX_AI_INPUT_CHARS.toLocaleString()} characters). Try running AI tools on a shorter section.`,
      },
    };
  }

  return { ok: true, content };
}

/**
 * Calls Gemini with a prompt built for strict-JSON output, parses the
 * response, and validates it against `schema`. Throws (never returns
 * unvalidated data) so every caller can share one catch block.
 */
async function generateStructured<T>(
  prompt: { system: string; prompt: string },
  schema: { parse: (data: unknown) => T },
  maxOutputTokens: number,
): Promise<T> {
  const provider = getAIProvider();
  const result = await provider.generateText({
    system: prompt.system,
    prompt: prompt.prompt,
    temperature: 0.3,
    maxOutputTokens,
  });
  const parsedJson = parseJsonResponse(result.text);
  return schema.parse(parsedJson);
}

export async function summarizeNote(
  noteId: string,
): Promise<AIActionResult<{ summary: string }>> {
  const loaded = await loadAuthorizedNoteContent(noteId);
  if (!loaded.ok) return loaded.result;

  try {
    const { summary } = await generateStructured(
      summarizePrompt(loaded.content),
      aiSummaryResultSchema,
      400,
    );
    return { success: true, data: { summary } };
  } catch (error) {
    logAIError("summarizeNote", error);
    return { success: false, error: getAIErrorMessage(error) };
  }
}

export async function extractKeyPoints(
  noteId: string,
): Promise<AIActionResult<{ keyPoints: string[] }>> {
  const loaded = await loadAuthorizedNoteContent(noteId);
  if (!loaded.ok) return loaded.result;

  try {
    const { keyPoints } = await generateStructured(
      keyPointsPrompt(loaded.content),
      aiKeyPointsResultSchema,
      500,
    );
    const normalized = normalizeKeyPoints(keyPoints);
    if (normalized.length === 0) {
      return { success: false, error: "The AI didn't find any key points in this note." };
    }
    return { success: true, data: { keyPoints: normalized } };
  } catch (error) {
    logAIError("extractKeyPoints", error);
    return { success: false, error: getAIErrorMessage(error) };
  }
}

export async function suggestNoteTags(
  noteId: string,
): Promise<AIActionResult<{ tags: string[] }>> {
  const loaded = await loadAuthorizedNoteContent(noteId);
  if (!loaded.ok) return loaded.result;

  try {
    const { tags } = await generateStructured(
      generateTagsPrompt(loaded.content),
      aiTagsResultSchema,
      500,
    );
    const normalized = normalizeSuggestedTags(tags);
    if (normalized.length === 0) {
      return { success: false, error: "The AI didn't suggest any usable tags for this note." };
    }
    return { success: true, data: { tags: normalized } };
  } catch (error) {
    logAIError("suggestNoteTags", error);
    return { success: false, error: getAIErrorMessage(error) };
  }
}

export async function rewriteNoteContent(
  noteId: string,
  mode: RewriteMode,
): Promise<AIActionResult<{ rewritten: string }>> {
  const parsedMode = rewriteModeSchema.safeParse(mode);
  if (!parsedMode.success) {
    return { success: false, error: "Unknown rewrite mode." };
  }

  const loaded = await loadAuthorizedNoteContent(noteId);
  if (!loaded.ok) return loaded.result;

  try {
    // Scale the output budget with input size (bounded) rather than a
    // single fixed cap — a short note shouldn't need a 4096-token
    // allowance, and a near-the-limit note needs more than 1024 to get
    // a complete, non-truncated rewrite back.
    const maxOutputTokens = Math.min(4096, Math.max(512, Math.ceil(loaded.content.length / 2)));

    const { rewritten } = await generateStructured(
      rewritePrompt(loaded.content, parsedMode.data),
      aiRewriteResultSchema,
      maxOutputTokens,
    );
    return { success: true, data: { rewritten } };
  } catch (error) {
    logAIError("rewriteNoteContent", error);
    return { success: false, error: getAIErrorMessage(error) };
  }
}

/**
 * Phase 7: embeddings + semantic search.
 *
 * These three actions are the entire embeddings/search surface — no
 * RAG, no "Ask My Notes", no multi-note chat (see README). Each
 * follows the exact same shape as the Phase 6 actions above: resolve
 * the user server-side, never trust a client-supplied id or user id,
 * and never let a provider/database failure surface as anything but a
 * short, safe message.
 */

export type SemanticSearchResult = { success: true; data: { results: NormalizedMatch[] } } | {
  success: false;
  error: string;
};

/**
 * Semantic (meaning-based) search across the signed-in user's own
 * notes. Complements, and never replaces, the keyword search in
 * lib/notes/queries.ts::listNotes — that RPC (search_note_ids) is
 * untouched by Phase 7 and keeps working exactly as before, including
 * when this action fails or Gemini is unavailable.
 *
 * Flow: validate the query -> resolve the authenticated user -> embed
 * the query text server-side (the browser never sees the API key or
 * generates an embedding itself) -> call the user- and
 * model-scoped match_notes RPC, which enforces RLS + auth.uid() (see
 * migration 0006) -> return similarity-ranked, normalized results.
 */
export async function semanticSearchNotes(query: string): Promise<SemanticSearchResult> {
  const parsed = semanticQuerySchema.safeParse(query);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid search text." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "You need to be signed in to search." };
  }

  const embeddingResult = await generateQueryEmbedding(parsed.data);
  if (!embeddingResult.ok) {
    return { success: false, error: embeddingResult.error };
  }

  const provider = getAIProvider();
  const { data, error } = await supabase.rpc("match_notes", {
    query_embedding: embeddingResult.embedding,
    match_user_id: user.id,
    match_embedding_model: provider.embeddingModelId,
    match_count: 8,
    match_threshold: 0.3,
  });

  if (error) {
    logAIError("semanticSearchNotes", error);
    return { success: false, error: "Semantic search is unavailable right now." };
  }

  return { success: true, data: { results: normalizeMatches(data ?? []) } };
}

export type RelatedNotesResult =
  | { success: true; data: { status: "ready"; results: NormalizedMatch[] } }
  | { success: true; data: { status: "indexing" } } // note has no embedding yet (pending/stale, not from a failure)
  | { success: true; data: { status: "too_large" } } // note exceeds the embedding input limit
  | { success: true; data: { status: "unavailable" } } // last embedding attempt failed
  | { success: false; error: string };

/**
 * Notes semantically similar to `noteId`, for the "Related Notes" panel
 * on a note's detail page. Never returns the note itself (enforced in
 * the match_related_notes RPC) and never returns another user's notes
 * (RLS + the RPC's own match_user_id/embedding_model filters — see
 * migration 0006).
 */
export async function getRelatedNotes(noteId: string): Promise<RelatedNotesResult> {
  const note = await getNoteById(noteId);
  if (!note) {
    return { success: false, error: "Note not found." };
  }

  if (note.embedding_status === "failed") {
    return { success: true, data: { status: "unavailable" } };
  }

  if (isInputTooLargeForEmbedding(note.title, note.content, MAX_EMBEDDING_INPUT_CHARS)) {
    return { success: true, data: { status: "too_large" } };
  }

  if (note.embedding_status !== "ready") {
    // 'pending' (never indexed) or 'stale' (indexing hasn't caught up
    // with the latest edit yet, e.g. the after()-scheduled reindex
    // triggered by the last save hasn't completed).
    return { success: true, data: { status: "indexing" } };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "You need to be signed in to view related notes." };
  }

  const provider = getAIProvider();

  // Read-time freshness verification (defense-in-depth on top of the
  // write-time race fix in lib/ai/embeddings.ts/reindex-coordinator.ts).
  // embedding_status === 'ready' is a cache for cheap UI reads, not
  // proof by itself — a residual race window (or an EMBEDDING_MODEL
  // change that hasn't triggered a fresh reindex yet) could otherwise
  // let a stale vector be treated as current. Recompute the note's
  // fingerprint and compare it against the stored embedding's own
  // metadata before ever calling the vector RPC.
  const { data: storedEmbedding } = await supabase
    .from("note_embeddings")
    .select("content_hash, embedding_model, embedding_dimensions")
    .eq("note_id", noteId)
    .maybeSingle();

  const fingerprint = computeContentFingerprint(note.title, note.content);
  const embeddingIsCurrent = storedEmbedding
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

  if (!embeddingIsCurrent) {
    // Either there's no usable embedding row, or the stored one is for
    // different content / a different model config than what's
    // currently persisted. Never let a stale vector reach
    // match_related_notes just because the cached status column says
    // 'ready' — surface the same "still indexing" state the UI already
    // knows how to show.
    return { success: true, data: { status: "indexing" } };
  }

  const { data, error } = await supabase.rpc("match_related_notes", {
    target_note_id: noteId,
    match_user_id: user.id,
    match_embedding_model: provider.embeddingModelId,
    match_count: 5,
    match_threshold: 0.3,
  });

  if (error) {
    logAIError("getRelatedNotes", error);
    return { success: true, data: { status: "unavailable" } };
  }

  return { success: true, data: { status: "ready", results: normalizeMatches(data ?? []) } };
}

/**
 * Explicit, user-triggered "Reindex" action — the retry path referenced
 * in the Phase 7 spec for a note stuck in 'failed' (e.g. a transient
 * Gemini outage during the last autosave-triggered attempt) or
 * 'too_large'. `force: true` bypasses the content-hash skip so a retry
 * always actually calls the provider again, rather than potentially
 * no-oping because the failed attempt already recorded the current
 * content's fingerprint before failing on the embedding call itself.
 */
export async function reindexNote(
  noteId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const note = await getNoteById(noteId);
  if (!note) {
    return { success: false, error: "Note not found." };
  }

  const outcome = await reindexNoteEmbedding(noteId, { force: true });

  switch (outcome.status) {
    case "ready":
    case "skipped":
      return { success: true };
    case "empty":
      return { success: false, error: "Add some content to this note before indexing it." };
    case "too_large":
      return {
        success: false,
        error: `This note is too large for semantic indexing right now (limit ~${MAX_EMBEDDING_INPUT_CHARS.toLocaleString()} characters).`,
      };
    case "not_found":
      return { success: false, error: "Note not found." };
    case "failed":
      return { success: false, error: outcome.error };
  }
}

/**
 * Server-side-only logging with no secrets and no raw provider payload
 * beyond what AIProviderError already carries — this is for operators
 * reading server logs, never sent to the client (see the try/catch in
 * each action above, which always returns getAIErrorMessage() instead).
 */
function logAIError(action: string, error: unknown) {
  if (error instanceof AIProviderError) {
    console.error(`[ai:${action}] provider error (${error.kind}):`, error.message, error.cause);
  } else if (error instanceof SyntaxError) {
    console.error(`[ai:${action}] invalid JSON from provider:`, error.message);
  } else if (error instanceof Error) {
    console.error(`[ai:${action}] error:`, error.message);
  } else {
    console.error(`[ai:${action}] unknown error`);
  }
}
