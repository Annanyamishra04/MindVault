import { createHash } from "node:crypto";

/**
 * Pure staleness-detection logic for note embeddings (Phase 7, section
 * 5 of the spec: "avoid the problem of note content = version B,
 * embedding = version A without knowing the embedding is stale").
 *
 * The chosen strategy is a content hash, not `updated_at` comparison:
 * `updated_at` changes on every save even when title/content come back
 * unchanged (e.g. a save cycle that only trims trailing whitespace
 * server-side, or a future field being touched by the same UPDATE),
 * which would cause needless re-embedding. A hash of the exact
 * {title, content} pair only changes when the text that's actually
 * embedded changes, which is the one thing that matters here.
 *
 * Kept side-effect-free and dependency-free (beyond Node's built-in
 * crypto) so it's trivial to unit test and safe to call from both
 * Server Actions and the `after()` background step (see
 * lib/ai/embeddings.ts) without pulling in Supabase or fetch.
 */

/**
 * A stable fingerprint of the exact text an embedding was (or would be)
 * generated from. Order and field separation are fixed and versioned
 * implicitly by this function's own behavior — changing this function's
 * output format is equivalent to invalidating every stored embedding,
 * since old hashes would stop matching newly computed ones (which is
 * the correct, safe outcome: treat everything as stale and re-embed,
 * rather than silently trusting embeddings from an old, unknown
 * representation).
 */
export function computeContentFingerprint(title: string, content: string): string {
  // A length-prefixed field separator (rather than a plain delimiter
  // character) means a title/content split at different points can't
  // hash-collide with a different title/content pair, e.g.
  // title="a", content="b|c" vs title="a|b", content="c".
  const normalizedTitle = title.trim();
  const normalizedContent = content.trim();
  const payload = `${normalizedTitle.length}:${normalizedTitle}\u0000${normalizedContent.length}:${normalizedContent}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * True if title + content together are too large to safely embed in
 * one request (see MAX_EMBEDDING_INPUT_CHARS, lib/ai/limits.ts, for
 * why this is a conservative character count rather than an exact
 * token count). Exported so both the actual reindex path
 * (lib/ai/embeddings.ts) and read-side UI messaging (explaining why a
 * particular note has no related notes) can agree on the same
 * definition without duplicating the arithmetic.
 */
export function isInputTooLargeForEmbedding(
  title: string,
  content: string,
  maxChars: number,
): boolean {
  return title.trim().length + content.trim().length > maxChars;
}

export interface StoredEmbeddingMetadata {
  contentHash: string;
  embeddingModel: string;
  embeddingDimensions: number;
}

export interface CurrentEmbeddingConfig {
  embeddingModel: string;
  embeddingDimensions: number;
}

/**
 * True if `stored` was generated from the same content and the same
 * model/dimension configuration currently in effect — i.e. it's safe
 * to reuse without calling the embedding provider again. False for a
 * missing embedding, a content change, or a model/config change (see
 * migration 0006 for why a model/dimension mismatch must never be
 * treated as current — the vector spaces aren't comparable).
 */
export function isEmbeddingCurrent(
  stored: StoredEmbeddingMetadata | null | undefined,
  fingerprint: string,
  current: CurrentEmbeddingConfig,
): boolean {
  if (!stored) return false;
  return (
    stored.contentHash === fingerprint &&
    stored.embeddingModel === current.embeddingModel &&
    stored.embeddingDimensions === current.embeddingDimensions
  );
}
