/**
 * Pure, dependency-free helpers for shaping raw match_notes /
 * match_related_notes RPC rows into what the UI renders. Kept separate
 * from lib/ai/embeddings.ts (which does the I/O) so this logic — the
 * part most likely to have an off-by-one or formatting bug — is easy
 * to unit test without a database or provider.
 */

/**
 * Clamps a raw pgvector cosine-similarity value into the closed
 * [0, 1] range. `1 - (a <=> b)` is mathematically in [-1, 1], but two
 * embeddings of genuinely different note content will never score
 * anywhere near 0 or below in practice — a negative value here would
 * far more likely indicate a bug (comparing vectors from different
 * models, or floating point rounding when they're near-identical). We
 * still don't crash the UI over it: clamp and move on, since a
 * similarity score is inherently a display detail, never something
 * that gates access to a note the user already owns.
 */
export function clampSimilarity(rawSimilarity: number): number {
  if (!Number.isFinite(rawSimilarity)) return 0;
  return Math.min(1, Math.max(0, rawSimilarity));
}

/** Renders a clamped similarity as a whole-number percentage for display (e.g. "82% match"). */
export function similarityToPercent(rawSimilarity: number): number {
  return Math.round(clampSimilarity(rawSimilarity) * 100);
}

/**
 * A short, single-line snippet for a semantic search result card:
 * prefers the note's AI summary (already a distilled 2-4 sentences —
 * see lib/ai/actions.ts::summarizeNote) when one exists, and falls
 * back to the start of the raw content, collapsing newlines so a
 * multi-paragraph note doesn't blow out a card's height.
 */
export function buildResultSnippet(
  content: string,
  summary: string | null | undefined,
  maxChars = 160,
): string {
  const source = (summary?.trim() || content.trim()).replace(/\s+/g, " ");
  if (source.length <= maxChars) return source;
  return `${source.slice(0, maxChars).trimEnd()}…`;
}

export interface RawMatchRow {
  note_id: string;
  title: string;
  similarity: number;
  summary?: string | null;
  content?: string | null;
}

export interface NormalizedMatch {
  noteId: string;
  title: string;
  snippet: string;
  similarityPercent: number;
}

/**
 * Normalizes a full batch of RPC rows in one pass: drops any row
 * missing a usable id/title (defensive — a malformed row should never
 * reach the UI as a broken link), and produces the exact shape the
 * result-list components render. `content`/`summary` are optional
 * because match_related_notes doesn't select `content` (see migration
 * 0003) — only match_notes does.
 */
export function normalizeMatches(rows: RawMatchRow[]): NormalizedMatch[] {
  const result: NormalizedMatch[] = [];
  for (const row of rows) {
    if (!row.note_id || typeof row.title !== "string") continue;
    result.push({
      noteId: row.note_id,
      title: row.title.trim() || "Untitled note",
      snippet: buildResultSnippet(row.content ?? "", row.summary),
      similarityPercent: similarityToPercent(row.similarity),
    });
  }
  return result;
}
