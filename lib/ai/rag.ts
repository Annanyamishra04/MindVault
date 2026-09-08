import { RAG_MAX_CITATIONS } from "@/lib/ai/limits";

/**
 * Pure, dependency-free helpers for the "Ask My Notes" RAG pipeline
 * (Phase 8). Kept separate from lib/ai/ask-actions.ts (which does the
 * I/O — auth, embedding, the match_notes RPC, the Gemini call) so the
 * two parts of this feature most likely to have a subtle bug — how
 * context gets built under a budget, and how a model's citations get
 * validated — are trivial to unit test without a database or provider,
 * following the same split used for semantic search
 * (lib/ai/semantic-normalize.ts) and embedding freshness
 * (lib/ai/embedding-fingerprint.ts).
 */

/** A ranked candidate note as returned by the match_notes RPC, already scoped to the caller by RLS + user id + embedding model. */
export interface RagCandidateRow {
  noteId: string;
  title: string;
  content: string;
  similarity: number;
}

/**
 * One note admitted into the Gemini prompt, with a stable
 * server-assigned identifier ("S1", "S2", ...) and its content
 * truncated to fit the per-note/total budget. `id` is what the model
 * is allowed to cite — never `noteId` directly — so a citation in the
 * model's response can be validated against a small, known set of
 * labels the server controls (see validateCitations below).
 */
export interface RagSource {
  id: string;
  noteId: string;
  title: string;
  content: string;
  similarity: number;
  truncated: boolean;
}

export interface RagContextBudget {
  /** Hard cap on the number of notes included, regardless of remaining character budget. */
  maxSources: number;
  /** Total character budget across every source's (possibly truncated) content. */
  maxTotalChars: number;
  /** Max characters taken from any single note, so one long note can't consume the whole budget by itself. */
  maxCharsPerNote: number;
}

/**
 * Deterministically truncates `content` to at most `maxChars`,
 * trimming trailing whitespace before appending an ellipsis so the cut
 * point never lands mid-word-boundary-looking-intact. Pure string
 * slicing — no sentence/word-boundary heuristics — so the same input
 * always produces the same output, which matters for testability and
 * for the "documented rule" the Phase 8 spec calls for (see
 * lib/ai/limits.ts's RAG_MAX_CHARS_PER_NOTE/RAG_CONTEXT_BUDGET_CHARS
 * comments).
 */
export function truncateForContext(content: string, maxChars: number): { text: string; truncated: boolean } {
  const trimmed = content.trim();
  if (trimmed.length <= maxChars) {
    return { text: trimmed, truncated: false };
  }
  return { text: `${trimmed.slice(0, maxChars).trimEnd()}…`, truncated: true };
}

/**
 * Builds the ranked, budget-limited, server-labeled source list sent
 * to Gemini for one question.
 *
 * Strategy (documented per Phase 8 spec section 6 — "use a
 * deterministic context-building strategy"):
 *   1. Assume `rows` is already ranked by relevance (match_notes
 *      orders by similarity) — this function does not re-sort.
 *   2. Walk the ranked list from the top.
 *   3. Truncate each note's content to at most `maxCharsPerNote`.
 *   4. Add it to the context if doing so doesn't exceed
 *      `maxTotalChars` *and* `maxSources` hasn't already been reached.
 *   5. Skip (not truncate further) a note that would push the running
 *      total over budget — a later, less relevant note existing at
 *      all doesn't mean an earlier, more relevant one gets short-changed;
 *      it just means the list ends there for this question.
 *
 * Source IDs ("S1", "S2", ...) are assigned in the same top-ranked
 * order and are stable for the lifetime of this one request/response —
 * they carry no meaning beyond "the Nth source in this answer" and are
 * never derived from note content, so nothing in a note (see prompt
 * injection defense in lib/ai/prompts.ts) can influence what a
 * citation label looks like.
 */
export function buildRagSources(rows: RagCandidateRow[], budget: RagContextBudget): RagSource[] {
  const sources: RagSource[] = [];
  let remainingChars = budget.maxTotalChars;

  for (const row of rows) {
    if (sources.length >= budget.maxSources) break;
    if (remainingChars <= 0) break;

    const perNoteCap = Math.min(budget.maxCharsPerNote, remainingChars);
    const { text, truncated } = truncateForContext(row.content, perNoteCap);
    if (!text) continue; // defensive: a note with no usable content contributes nothing

    sources.push({
      id: `S${sources.length + 1}`,
      noteId: row.noteId,
      title: row.title.trim() || "Untitled note",
      content: text,
      similarity: row.similarity,
      truncated,
    });
    remainingChars -= text.length;
  }

  return sources;
}

/**
 * Renders the admitted sources into the delimited block the RAG prompt
 * gives Gemini as untrusted reference material (see
 * lib/ai/prompts.ts::ragAnswerPrompt). Kept here, next to
 * buildRagSources, so the two stay in sync — the labels this function
 * prints are exactly the labels validateCitations below will accept.
 */
export function formatSourcesForPrompt(sources: RagSource[]): string {
  return sources
    .map((s) => `[${s.id}]\nTitle: ${s.title}\nContent:\n${s.content}`)
    .join("\n\n");
}

export interface RawCitation {
  sourceId: string;
}

/**
 * Validates and normalizes the citations Gemini returned against the
 * actual set of sources that were included in its prompt.
 *
 * - Any sourceId not in `validSourceIds` is dropped — the model is
 *   never allowed to invent a source that either wasn't retrieved at
 *   all or didn't make it past the context budget (Phase 8 spec
 *   section 11).
 * - Duplicates are normalized to a single entry, order-preserving by
 *   first occurrence.
 * - The result is capped at RAG_MAX_CITATIONS as a final defensive
 *   bound, independent of whatever the schema already allowed through.
 */
export function validateCitations(raw: RawCitation[], validSourceIds: readonly string[]): string[] {
  const valid = new Set(validSourceIds);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const { sourceId } of raw) {
    const id = sourceId.trim();
    if (!id || !valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= RAG_MAX_CITATIONS) break;
  }

  return result;
}

/**
 * Phase 8.1: the server-side grounding invariant.
 *
 * `ragAnswerResultSchema` (lib/ai/schemas.ts) validates only the
 * *shape* of Gemini's response — it deliberately allows an empty
 * `citations` array, since a model that honestly reports "the notes
 * don't cover this" has no source to cite and shouldn't be forced to
 * fabricate one just to satisfy a schema. `validateCitations` above
 * then strips any citation that doesn't correspond to a real,
 * in-context source. Neither step by itself guarantees the thing that
 * actually matters to the person reading the answer: that a response
 * presented as coming from their notes has at least one real note
 * behind it.
 *
 * This function is that third, separate check — deliberately kept out
 * of both the schema (provider *shape* validation) and
 * validateCitations (per-citation *authenticity* validation), so each
 * of the three concerns stays independently testable and none of them
 * silently absorbs the others' job:
 *
 *   1. Schema validation: "is this valid JSON of the right shape?"
 *   2. Citation validation: "which claimed citations are real?"
 *   3. Grounding validation (this function): "given the real
 *      citations that survived step 2, is there enough here to call
 *      this an answered, note-backed result at all?"
 *
 * The rule is intentionally simple and categorical: an answer is
 * "grounded" if and only if at least one citation survived
 * validateCitations. This covers every way an ungrounded answer can
 * arise — Gemini cited nothing, Gemini cited only a fabricated/expired
 * label, or every citation it gave got filtered out — with one rule,
 * rather than trying to infer intent from the answer text (e.g.
 * pattern-matching for "the notes don't cover this" phrasing), which
 * would be both fragile and easy for a subtly different phrasing to
 * slip past.
 *
 * Callers (lib/ai/ask-actions.ts) must never surface `raw.answer` to
 * the client when `grounded` is false — see that module for the
 * resulting "unsupported" outcome, which shows a safe, generic message
 * instead of an answer this function couldn't verify.
 */
export interface GroundingResult {
  grounded: boolean;
  citedIds: string[];
}

export function evaluateGrounding(raw: RawCitation[], validSourceIds: readonly string[]): GroundingResult {
  const citedIds = validateCitations(raw, validSourceIds);
  return { grounded: citedIds.length > 0, citedIds };
}
