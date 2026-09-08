/**
 * AI provider abstraction.
 *
 * The rest of the application (API routes, RAG pipeline, embedding
 * service) depends only on this interface, never on a specific vendor
 * SDK. To add a new provider (OpenAI, Anthropic, a local model, etc.),
 * implement `AIProvider` in a new file under `lib/ai/` and switch the
 * export in `lib/ai/index.ts` — no other file needs to change.
 */

export interface GenerateTextOptions {
  /** System-level instructions for the model. */
  system?: string;
  /** The user-facing prompt / task. */
  prompt: string;
  /** Sampling temperature. Lower is more deterministic. */
  temperature?: number;
  /** Hard cap on generated tokens, to keep responses fast and cheap. */
  maxOutputTokens?: number;
}

export interface GenerateTextResult {
  text: string;
  /** Raw token usage if the provider reports it, for logging/monitoring. */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export class AIProviderError extends Error {
  readonly kind: "rate_limit" | "timeout" | "invalid_request" | "unknown";
  readonly cause?: unknown;

  constructor(
    message: string,
    kind: "rate_limit" | "timeout" | "invalid_request" | "unknown",
    cause?: unknown,
  ) {
    super(message);
    this.name = "AIProviderError";
    this.kind = kind;
    this.cause = cause;
  }
}

export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export interface AIProvider {
  /** Human-readable id, used in logs (e.g. "gemini"). */
  readonly id: string;

  /** Generate free-form text for summaries, tags, rewrites, and RAG answers. */
  generateText(options: GenerateTextOptions): Promise<GenerateTextResult>;

  /**
   * Generate a single embedding vector for a piece of text.
   *
   * `taskType` tells the model whether this text is something being
   * indexed ("RETRIEVAL_DOCUMENT", the default — used when embedding a
   * saved note) or a search question ("RETRIEVAL_QUERY" — used when
   * embedding what the user typed into search or Ask My Notes). Gemini's
   * embedding model produces measurably better retrieval quality when
   * this is set correctly on both sides of a similarity search.
   *
   * `documentTitle`, when given alongside `taskType: "RETRIEVAL_DOCUMENT"`,
   * lets a provider that supports asymmetric retrieval formatting (like
   * Gemini's `title: {title} | text: {content}`) include the note's
   * actual title rather than a generic placeholder. Ignored for
   * `RETRIEVAL_QUERY` and by providers that don't use this formatting.
   */
  generateEmbedding(
    text: string,
    taskType?: EmbeddingTaskType,
    documentTitle?: string,
  ): Promise<number[]>;

  /** Dimensionality of vectors returned by `generateEmbedding`, used to size the pgvector column. */
  readonly embeddingDimensions: number;

  /**
   * Identifies which embedding model this provider currently generates
   * vectors with (e.g. "gemini-embedding-2"), stored alongside every
   * embedding row so a later model/config change can never be silently
   * compared against vectors from an incompatible embedding space (see
   * supabase/migrations/0006_phase7_semantic_search.sql).
   */
  readonly embeddingModelId: string;
}
