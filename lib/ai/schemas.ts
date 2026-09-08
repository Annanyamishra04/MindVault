import { z } from "zod";
import {
  MAX_ASK_QUESTION_CHARS,
  MAX_KEY_POINT_CHARS,
  MAX_KEY_POINTS,
  MAX_SEMANTIC_QUERY_CHARS,
  MAX_SUMMARY_CHARS,
  MAX_TAG_CHARS,
  MAX_TAG_SUGGESTIONS,
  RAG_MAX_ANSWER_CHARS,
  RAG_MAX_CITATIONS,
} from "@/lib/ai/limits";

/**
 * Every AI action asks Gemini to return JSON in one of these exact
 * shapes (see lib/ai/prompts.ts). Gemini is a text model, not a
 * database — it can still return malformed JSON, extra commentary,
 * wrong types, or an empty response. Nothing here is trusted until it
 * passes the matching schema; a failure is treated the same as any
 * other provider error, never shown to the user as-is.
 */

export const aiSummaryResultSchema = z.object({
  summary: z.string().trim().min(1).max(MAX_SUMMARY_CHARS),
});
export type AISummaryResult = z.infer<typeof aiSummaryResultSchema>;

export const aiKeyPointsResultSchema = z.object({
  keyPoints: z
    .array(z.string().trim().min(1).max(MAX_KEY_POINT_CHARS))
    .max(MAX_KEY_POINTS * 2), // generous ceiling; normalize.ts trims to MAX_KEY_POINTS
});
export type AIKeyPointsResult = z.infer<typeof aiKeyPointsResultSchema>;

export const aiTagsResultSchema = z.object({
  tags: z
    .array(z.string().trim().min(1).max(MAX_TAG_CHARS))
    .max(MAX_TAG_SUGGESTIONS * 3), // generous ceiling; normalize.ts dedupes/trims
});
export type AITagsResult = z.infer<typeof aiTagsResultSchema>;

export const aiRewriteResultSchema = z.object({
  rewritten: z.string().trim().min(1).max(100_000),
});
export type AIRewriteResult = z.infer<typeof aiRewriteResultSchema>;

/** The three rewrite modes exposed in the UI — kept deliberately small. */
export const rewriteModeSchema = z.enum(["improve", "concise", "professional"]);
export type RewriteMode = z.infer<typeof rewriteModeSchema>;

export const rewriteModeLabels: Record<RewriteMode, string> = {
  improve: "Improve clarity",
  concise: "Make concise",
  professional: "Make professional",
};

/**
 * Validates a semantic search query before it ever reaches the
 * embedding provider. Mirrors the note/tag schemas above: re-validated
 * server-side in the Server Action regardless of any client-side check.
 */
export const semanticQuerySchema = z
  .string()
  .trim()
  .min(1, "Type something to search by meaning.")
  .max(
    MAX_SEMANTIC_QUERY_CHARS,
    `Search text must be ${MAX_SEMANTIC_QUERY_CHARS} characters or fewer.`,
  );

/**
 * Phase 8: validates an "Ask My Notes" question before it's ever
 * embedded or sent anywhere. Same shape as `semanticQuerySchema` (a
 * blank/whitespace-only question is rejected by `.min(1)` after
 * `.trim()`, and an absurdly long one is rejected outright rather than
 * silently truncated) but kept as its own schema/constant so the two
 * features' limits can move independently.
 */
export const askQuestionSchema = z
  .string()
  .trim()
  .min(1, "Type a question about your notes.")
  .max(
    MAX_ASK_QUESTION_CHARS,
    `Questions must be ${MAX_ASK_QUESTION_CHARS} characters or fewer.`,
  );

/**
 * The exact JSON shape the RAG prompt (lib/ai/prompts.ts::ragAnswerPrompt)
 * asks Gemini for. `citations` deliberately carries only a `sourceId` —
 * a server-assigned "S1"/"S2"/... label (see lib/ai/rag.ts) — never a
 * note id, title, or URL, so the model has no fields available to
 * fabricate that could be mistaken for real note metadata. Every
 * sourceId is re-validated against the actual retrieved source set in
 * lib/ai/rag.ts::validateCitations before anything is returned to the
 * client; this schema only guarantees the *shape* is well-formed, not
 * that any given id is real.
 */
export const ragAnswerResultSchema = z.object({
  answer: z.string().trim().min(1).max(RAG_MAX_ANSWER_CHARS),
  citations: z
    .array(z.object({ sourceId: z.string().trim().min(1) }))
    .max(RAG_MAX_CITATIONS * 4), // generous ceiling; validateCitations dedupes/filters/caps
});
export type RagAnswerResult = z.infer<typeof ragAnswerResultSchema>;
