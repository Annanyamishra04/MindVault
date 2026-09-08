/**
 * Size limits for AI operations, separate from `noteContentSchema`
 * (lib/validation/notes.ts, capped at 100,000 characters — the limit
 * for what a note is *allowed to contain*).
 *
 * AI operations use a much lower cap. Gemini 2.5 Flash's context window
 * is far larger than this, but a tight application-level limit keeps
 * latency predictable, keeps free-tier token usage bounded, and avoids
 * silently-truncated input producing misleading summaries. A user with
 * a note this long is rare; when it happens, they get a clear "too
 * long for AI tools" message rather than a truncated, misleading result.
 */
export const MAX_AI_INPUT_CHARS = 20_000;

/** Upper bounds on validated AI *output*, to catch a runaway/malformed response. */
export const MAX_SUMMARY_CHARS = 2_000;
export const MAX_KEY_POINT_CHARS = 300;
export const MAX_KEY_POINTS = 6;
export const MAX_TAG_CHARS = 60;
export const MAX_TAG_SUGGESTIONS = 6;

/**
 * Size limit for embedding *input*, separate from MAX_AI_INPUT_CHARS
 * above (which governs the text-generation actions in this file's
 * sibling, actions.ts) and from `noteContentSchema` (100,000 chars —
 * what a note is allowed to contain at all).
 *
 * gemini-embedding-2's real limit is 8,192 tokens, shared across the
 * title/text formatting wrapper this app adds (lib/ai/gemini.ts) and
 * the note's title + content. There's no exact token count available
 * without calling the provider, so this uses a conservative
 * characters-per-token estimate (English text averages ~4 chars/token;
 * some languages and heavy punctuation run denser) to stay safely
 * under the real limit rather than relying on Gemini's undocumented
 * silent-truncation behavior for oversized input. Phase 7 intentionally
 * does not implement chunking (see README) — a note over this limit
 * gets a clear "too large for semantic indexing" outcome instead of a
 * misleading partial embedding.
 */
export const MAX_EMBEDDING_INPUT_CHARS = 24_000;

/** Query text for semantic search / "Ask My Notes" — much shorter than a note, so a much lower cap. */
export const MAX_SEMANTIC_QUERY_CHARS = 500;

/**
 * Phase 8: "Ask My Notes" (RAG).
 *
 * A question is user-typed natural language, so it gets the same shape
 * of cap as the semantic search box (MAX_SEMANTIC_QUERY_CHARS) rather
 * than a separate number — kept as its own named constant anyway so
 * the two features can diverge later without one silently changing
 * the other's limit.
 */
export const MAX_ASK_QUESTION_CHARS = 500;

/**
 * How many candidate notes match_notes is asked for before this app's
 * own context-budget logic (lib/ai/rag.ts) decides how many actually
 * make it into the Gemini prompt. Wider than RAG_MAX_SOURCES so the
 * budget step has real ranked candidates to choose from rather than
 * exactly the number it might use.
 */
export const RAG_CANDIDATE_COUNT = 8;

/**
 * Minimum cosine similarity (see clampSimilarity, lib/ai/semantic-normalize.ts,
 * for why this is always in [0, 1]) for a note to be considered
 * "relevant enough" to answer from.
 *
 * Phase 7's semantic search and Related Notes both use 0.3 as an
 * exploratory-browsing threshold — a loose bar is fine there because a
 * human is scanning a results list and can ignore a weak match. RAG is
 * different: whatever passes this bar gets fed to Gemini and presented
 * as the grounds for an authoritative-sounding answer, so a weak match
 * is actively misleading rather than just mildly unhelpful. 0.5 is
 * chosen as a stricter bar on the same 0-1 scale, roughly the point
 * where two note embeddings are actually about the same subject rather
 * than merely sharing some vocabulary or tone.
 */
export const RAG_RELEVANCE_THRESHOLD = 0.5;

/** Hard cap on how many notes are ever sent to Gemini as context for one question. */
export const RAG_MAX_SOURCES = 5;

/**
 * Total character budget across all retrieved note content sent to
 * Gemini for one question, on top of MAX_ASK_QUESTION_CHARS for the
 * question itself. Sized well under MAX_AI_INPUT_CHARS (which governs
 * single-note operations) since RAG can combine content from several
 * notes into one request.
 */
export const RAG_CONTEXT_BUDGET_CHARS = 12_000;

/** Max characters taken from any single note's content when building RAG context, so one long note can't consume the whole budget. */
export const RAG_MAX_CHARS_PER_NOTE = 4_000;

/** Upper bound on validated RAG answer length and citation count, to catch a runaway/malformed model response. */
export const RAG_MAX_ANSWER_CHARS = 4_000;
export const RAG_MAX_CITATIONS = RAG_MAX_SOURCES;

/** Max length of a source excerpt shown in the Ask My Notes UI (display-only truncation, separate from RAG_MAX_CHARS_PER_NOTE's prompt-context truncation). */
export const RAG_MAX_EXCERPT_CHARS = 200;
