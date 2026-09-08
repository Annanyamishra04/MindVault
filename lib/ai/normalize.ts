import { tagNameSchema } from "@/lib/validation/notes";
import { MAX_KEY_POINTS, MAX_TAG_SUGGESTIONS } from "@/lib/ai/limits";

/**
 * Cleans up Gemini's raw `keyPoints` array: trims whitespace, drops
 * empty entries, removes exact duplicates (case-insensitive), and caps
 * the list length. Pure and side-effect-free so it's easy to unit test
 * and to reuse if another AI feature ever needs the same shape.
 */
export function normalizeKeyPoints(points: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of points) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length >= MAX_KEY_POINTS) break;
  }

  return result;
}

/**
 * Cleans up Gemini's raw `tags` array using the same `tagNameSchema`
 * the rest of the app enforces for user-typed tags (lib/validation/notes.ts)
 * — an AI suggestion is not exempt from the rules a human-entered tag
 * follows. Malformed suggestions (too long, contain line breaks, etc.)
 * are silently dropped rather than surfaced as an error; a slightly
 * shorter suggestion list is a better experience than blocking on it.
 */
export function normalizeSuggestedTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of tags) {
    const parsed = tagNameSchema.safeParse(raw);
    if (!parsed.success) continue;
    const key = parsed.data.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(parsed.data);
    if (result.length >= MAX_TAG_SUGGESTIONS) break;
  }

  return result;
}

/**
 * Best-effort extraction of a JSON object from a Gemini text response.
 * Models frequently wrap JSON in a ```json ... ``` fence even when
 * explicitly told not to; this strips a leading/trailing fence (of
 * either flavor) before handing the result to `JSON.parse`. Throws
 * (like `JSON.parse`) if the result still isn't valid JSON — callers
 * are expected to catch that and treat it as an invalid AI response,
 * not to recover partial data from it.
 */
export function parseJsonResponse(raw: string): unknown {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(withoutFence);
}
