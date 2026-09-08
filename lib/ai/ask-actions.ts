"use server";

import { getAIProvider, AIProviderError } from "@/lib/ai";
import { getAIErrorMessage } from "@/lib/ai/errors";
import { generateQueryEmbedding } from "@/lib/ai/embeddings";
import {
  RAG_CANDIDATE_COUNT,
  RAG_CONTEXT_BUDGET_CHARS,
  RAG_MAX_CHARS_PER_NOTE,
  RAG_MAX_EXCERPT_CHARS,
  RAG_MAX_SOURCES,
  RAG_RELEVANCE_THRESHOLD,
} from "@/lib/ai/limits";
import { parseJsonResponse } from "@/lib/ai/normalize";
import { ragAnswerPrompt } from "@/lib/ai/prompts";
import { askQuestionSchema, ragAnswerResultSchema } from "@/lib/ai/schemas";
import {
  buildRagSources,
  evaluateGrounding,
  formatSourcesForPrompt,
  truncateForContext,
  type RagCandidateRow,
} from "@/lib/ai/rag";
import { similarityToPercent } from "@/lib/ai/semantic-normalize";
import { createClient } from "@/lib/supabase/server";

/**
 * "Ask My Notes" (Phase 8) — Retrieval-Augmented Generation over the
 * signed-in user's own notes.
 *
 * Follows the same architecture as every other AI action in this app
 * (lib/ai/actions.ts, lib/ai/embeddings.ts): the browser sends only the
 * question text; everything else — authentication, query embedding,
 * retrieval, context assembly, the Gemini call, and citation
 * validation — happens here, server-side, using the RLS-scoped
 * Supabase client. See lib/ai/rag.ts for the pure context-budget and
 * citation-validation logic this file wires up to real I/O.
 *
 * Deliberately stateless (Phase 8 spec section 22): no question,
 * answer, or prompt is ever written to the database. Every call is an
 * independent retrieval — there is no conversational memory, hidden or
 * otherwise (spec section 14).
 */

export interface AskSource {
  noteId: string;
  title: string;
  excerpt: string;
  similarityPercent: number;
}

export type AskMyNotesResult =
  | { success: true; data: { status: "answered"; answer: string; sources: AskSource[] } }
  // A: retrieval ran, but nothing cleared the relevance bar (or the
  // user has no indexed notes at all). Gemini is never called for this case.
  | { success: true; data: { status: "no_results" } }
  // B: the query embedding or the vector search itself failed/is unavailable.
  | { success: true; data: { status: "index_unavailable" } }
  // C: relevant notes were found and sent to Gemini, but answer generation failed
  // (provider error, timeout, or malformed/schema-invalid JSON).
  | { success: true; data: { status: "answer_failed" } }
  // D (Phase 8.1): Gemini returned a well-formed, schema-valid answer,
  // but it carries zero server-validated citations once
  // lib/ai/rag.ts::evaluateGrounding checks its claimed citations
  // against the sources actually retrieved — whether because Gemini
  // cited nothing, cited only a fabricated/out-of-context label, or
  // (legitimately) reported that the notes don't cover this. The
  // grounding invariant (see evaluateGrounding's docstring) requires
  // treating all three the same way: never as "answered". `raw.answer`
  // is intentionally NOT included here — an ungrounded answer's text
  // is never surfaced to the client, since there is no validated
  // source backing it up to justify showing it as if it came from the
  // user's notes.
  | { success: true; data: { status: "unsupported" } }
  // Validation / authentication failures — not a RAG-pipeline outcome.
  | { success: false; error: string };

export async function askMyNotes(question: string): Promise<AskMyNotesResult> {
  const parsedQuestion = askQuestionSchema.safeParse(question);
  if (!parsedQuestion.success) {
    return { success: false, error: parsedQuestion.error.issues[0]?.message ?? "Invalid question." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "You need to be signed in to ask questions about your notes." };
  }

  // --- Retrieval -----------------------------------------------------
  //
  // Reuses the exact same query-embedding path and match_notes RPC as
  // Phase 7's semanticSearchNotes (lib/ai/actions.ts) — the "existing
  // approved semantic-search path" the spec calls for — just with a
  // stricter relevance threshold appropriate for grounding an answer
  // rather than surfacing browsable results (see RAG_RELEVANCE_THRESHOLD).

  const embeddingResult = await generateQueryEmbedding(parsedQuestion.data);
  if (!embeddingResult.ok) {
    logAskError("askMyNotes:embedding", embeddingResult.error);
    return { success: true, data: { status: "index_unavailable" } };
  }

  const provider = getAIProvider();
  const { data: matches, error: rpcError } = await supabase.rpc("match_notes", {
    query_embedding: embeddingResult.embedding,
    match_user_id: user.id,
    match_embedding_model: provider.embeddingModelId,
    match_count: RAG_CANDIDATE_COUNT,
    match_threshold: RAG_RELEVANCE_THRESHOLD,
  });

  if (rpcError) {
    logAskError("askMyNotes:match_notes", rpcError);
    return { success: true, data: { status: "index_unavailable" } };
  }

  if (!matches || matches.length === 0) {
    return { success: true, data: { status: "no_results" } };
  }

  // Defense-in-depth freshness check (Phase 8 spec section 5): match_notes
  // already scopes by user_id and the currently configured embedding
  // model (migration 0006), which excludes another user's notes and
  // any leftover vector from a previously configured model/dimension.
  // It does not know about the per-note 'stale' flag Phase 7 added for
  // "content changed since the last successful embedding, reindex not
  // caught up yet" — a stale note's *ranking* may reflect an older
  // version of the note even though match_notes always joins the
  // note's live content (see migration 0006's `n.content`, not a
  // cached copy). Rather than duplicate the content-hash comparison
  // embeddings.ts/actions.ts already own, this reuses the same cached
  // embedding_status column Related Notes trusts for its own
  // "indexing"/"unavailable" states, applied here as a batch filter.
  const candidateIds = matches.map((m) => m.note_id);
  const { data: statusRows, error: statusError } = await supabase
    .from("notes")
    .select("id, embedding_status")
    .in("id", candidateIds);

  if (statusError) {
    logAskError("askMyNotes:embedding_status", statusError);
    return { success: true, data: { status: "index_unavailable" } };
  }

  const readyIds = new Set(
    (statusRows ?? []).filter((r) => r.embedding_status === "ready").map((r) => r.id),
  );
  const freshMatches = matches.filter((m) => readyIds.has(m.note_id));

  if (freshMatches.length === 0) {
    // Every candidate that cleared the relevance bar is currently
    // stale/failed/pending — from the user's perspective this is the
    // same "nothing usable to answer from right now" outcome as no
    // matches at all. Never fall back to a weaker, unfiltered result.
    return { success: true, data: { status: "no_results" } };
  }

  // --- Context budget --------------------------------------------------

  const candidates: RagCandidateRow[] = freshMatches.map((m) => ({
    noteId: m.note_id,
    title: m.title,
    content: m.content,
    similarity: m.similarity,
  }));

  const sources = buildRagSources(candidates, {
    maxSources: RAG_MAX_SOURCES,
    maxTotalChars: RAG_CONTEXT_BUDGET_CHARS,
    maxCharsPerNote: RAG_MAX_CHARS_PER_NOTE,
  });

  if (sources.length === 0) {
    return { success: true, data: { status: "no_results" } };
  }

  // --- Grounded answer generation --------------------------------------

  let raw: { answer: string; citations: { sourceId: string }[] };
  try {
    const prompt = ragAnswerPrompt(parsedQuestion.data, formatSourcesForPrompt(sources));
    const result = await provider.generateText({
      system: prompt.system,
      prompt: prompt.prompt,
      temperature: 0.2,
      maxOutputTokens: 2048,
    });
    const parsedJson = parseJsonResponse(result.text);
    raw = ragAnswerResultSchema.parse(parsedJson);
  } catch (error) {
    logAskError("askMyNotes:generate", error);
    return { success: true, data: { status: "answer_failed" } };
  }

  // --- Citation validation + grounding invariant ------------------------
  //
  // The model may only cite labels ("S1", "S2", ...) that were actually
  // included in its prompt. Anything else — a fabricated label, a
  // label for a source that got cut by the context budget, a duplicate —
  // is rejected here before any of it reaches the client (Phase 8 spec
  // section 11). Only sources with a validated citation are returned;
  // a source that was in context but never cited isn't shown as "used".
  //
  // Phase 8.1: passing schema + citation validation is not enough to
  // call this "answered" — evaluateGrounding enforces the separate,
  // stricter invariant that a note-backed answer must have at least
  // one citation that survived validation. See evaluateGrounding's
  // docstring (lib/ai/rag.ts) for why this can't be delegated to the
  // schema or to validateCitations alone, and why it deliberately
  // doesn't try to infer intent from the answer text.
  const validSourceIds = sources.map((s) => s.id);
  const grounding = evaluateGrounding(raw.citations, validSourceIds);

  if (!grounding.grounded) {
    // Never forward raw.answer here — whether Gemini cited nothing,
    // cited only a fabricated/out-of-context label, or legitimately
    // reported the notes don't cover this, none of those are
    // distinguishable from "ungrounded claim" without a citation to
    // check, so none of them get shown as a successful answer.
    return { success: true, data: { status: "unsupported" } };
  }

  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const citedSources: AskSource[] = grounding.citedIds
    .map((id) => sourceById.get(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({
      noteId: s.noteId,
      title: s.title,
      excerpt: truncateForContext(s.content, RAG_MAX_EXCERPT_CHARS).text,
      similarityPercent: similarityToPercent(s.similarity),
    }));

  return {
    success: true,
    data: { status: "answered", answer: raw.answer, sources: citedSources },
  };
}

/** Same logging convention as lib/ai/actions.ts::logAIError — no secrets, never sent to the client. */
function logAskError(action: string, error: unknown) {
  if (error instanceof AIProviderError) {
    console.error(`[ai:${action}] provider error (${error.kind}):`, getAIErrorMessage(error));
  } else if (error instanceof SyntaxError) {
    console.error(`[ai:${action}] invalid JSON from provider:`, error.message);
  } else if (error instanceof Error) {
    console.error(`[ai:${action}] error:`, error.message);
  } else if (typeof error === "string") {
    console.error(`[ai:${action}] error:`, error);
  } else {
    console.error(`[ai:${action}] unknown error`);
  }
}
