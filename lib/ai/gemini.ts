import {
  AIProviderError,
  type AIProvider,
  type EmbeddingTaskType,
  type GenerateTextOptions,
  type GenerateTextResult,
} from "./provider";

/**
 * Gemini implementation of AIProvider, using the Gemini REST API directly
 * (no SDK dependency, to keep the footprint small). Model names are read
 * from environment variables rather than hardcoded, per project
 * requirements — if Google renames or deprecates a model, this keeps
 * working by just updating `.env`.
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function callWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new AIProviderError("AI request timed out", "timeout")),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

export class GeminiProvider implements AIProvider {
  readonly id = "gemini";

  // gemini-embedding-2 (like its predecessor gemini-embedding-001)
  // natively outputs 3072-dim vectors but is trained with Matryoshka
  // (MRL) truncation, so a smaller `output_dimensionality` stays
  // high-quality. We request 768: Google's guidance is that 768/1536/3072
  // all retain most of the model's retrieval quality, and 768 is the
  // only one of those that fits under pgvector's 2000-dimension
  // ANN-index ceiling while also keeping storage/compute minimal for the
  // free tier. This constant MUST match both the `output_dimensionality`
  // sent below and the `vector(768)` column in
  // supabase/migrations/0001_init_schema.sql — if any one of the three
  // changes, all three must change together.
  readonly embeddingDimensions = 768;

  private get apiKey() {
    return requireEnv("AI_API_KEY");
  }

  private get model() {
    // gemini-2.0-flash was shut down June 2026; gemini-2.5-flash is the
    // current stable default as of this writing. Google deprecates
    // Gemini models on a rolling basis (see
    // https://ai.google.dev/gemini-api/docs/models for the live list),
    // so this is intentionally read from an env var rather than
    // hardcoded elsewhere — update AI_MODEL in .env when Google
    // announces the next retirement.
    return process.env.AI_MODEL || "gemini-2.5-flash";
  }

  private get embeddingModel() {
    // text-embedding-004 was fully shut down in January 2026.
    // gemini-embedding-2 is the current default: it's Google's first
    // multimodal embedding model, and at truncated dimensions (like the
    // 768 we request) it auto-normalizes its output, which
    // gemini-embedding-001 does not (see generateEmbedding below). Note
    // that the embedding spaces of the two models are NOT compatible —
    // switching EMBEDDING_MODEL requires re-embedding all existing notes.
    return process.env.EMBEDDING_MODEL || "gemini-embedding-2";
  }

  /**
   * Public identifier stored on every note_embeddings row (see
   * lib/ai/embeddings.ts and migration 0006). Same value as the private
   * `embeddingModel` getter above; exposed read-only so callers can tag
   * and later filter embeddings by the model that produced them without
   * this class leaking its env-var lookup mechanics.
   */
  get embeddingModelId(): string {
    return this.embeddingModel;
  }

  async generateText({
    system,
    prompt,
    temperature = 0.4,
    maxOutputTokens = 1024,
  }: GenerateTextOptions): Promise<GenerateTextResult> {
        const url = `${GEMINI_API_BASE}/models/${this.model}:generateContent`;

    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: {
        temperature,
        maxOutputTokens,
      },
    };

    let response: Response;
    try {
      response = await callWithTimeout(
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify(body),
        }),
        60_000,
      );
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      throw new AIProviderError("Failed to reach the AI provider", "unknown", err);
    }

    if (response.status === 429) {
      throw new AIProviderError(
        "The AI provider is rate-limiting requests. Please try again shortly.",
        "rate_limit",
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new AIProviderError(
        `AI provider returned an error (${response.status})`,
        "invalid_request",
        errorBody,
      );
    }

    const data = await response.json();
    const text: string | undefined =
      data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");

    if (!text) {
      throw new AIProviderError("AI provider returned an empty response", "unknown", data);
    }

    return {
      text,
      usage: {
        inputTokens: data?.usageMetadata?.promptTokenCount,
        outputTokens: data?.usageMetadata?.candidatesTokenCount,
      },
    };
  }

  async generateEmbedding(
    text: string,
    taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT",
    documentTitle?: string,
  ): Promise<number[]> {
        const url = `${GEMINI_API_BASE}/models/${this.embeddingModel}:embedContent`;

    // gemini-embedding-2 does not support the `taskType` request field
    // that gemini-embedding-001 used — passing it is simply ignored, so
    // task intent must instead be baked into the text itself, using
    // Google's documented asymmetric-retrieval prefix format: the query
    // side gets `task: search result | query: ...` and the document side
    // gets `title: {title} | text: ...`, falling back to the documented
    // `none` placeholder when no title is given (or for query-side text,
    // where a title never applies).
    // See https://ai.google.dev/gemini-api/docs/embeddings#retrieval-use-cases-asymmetric-format
    const formattedText =
      taskType === "RETRIEVAL_QUERY"
        ? `task: search result | query: ${text}`
        : `title: ${documentTitle?.trim() || "none"} | text: ${text}`;

    let response: Response;
    try {
      response = await callWithTimeout(
        fetch(url, {
          method: "POST",
                    headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify({
            model: `models/${this.embeddingModel}`,
            content: { parts: [{ text: formattedText }] },
            // Snake_case per Google's current gemini-embedding-2 REST
            // examples. Truncating to 768 here does NOT require manual
            // normalization: unlike gemini-embedding-001,
            // gemini-embedding-2 auto-normalizes non-default output
            // dimensions (768/1536), so the `<=>` cosine-distance operator
            // used throughout this project's pgvector queries operates on
            // an already-unit-length vector. See "Ensuring quality for
            // smaller dimensions" at
            // https://ai.google.dev/gemini-api/docs/embeddings
            output_dimensionality: this.embeddingDimensions,
          }),
        }),
        30_000,
      );
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      throw new AIProviderError("Failed to reach the embedding provider", "unknown", err);
    }

    if (response.status === 429) {
      throw new AIProviderError(
        "The embedding provider is rate-limiting requests.",
        "rate_limit",
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new AIProviderError(
        `Embedding provider returned an error (${response.status})`,
        "invalid_request",
        errorBody,
      );
    }

    const data = await response.json();
    const values: number[] | undefined = data?.embedding?.values;

    if (!values || values.length === 0) {
      throw new AIProviderError("Embedding provider returned no vector", "unknown", data);
    }

    if (values.length !== this.embeddingDimensions) {
      // Fail loudly rather than silently inserting a mis-sized vector —
      // pgvector's vector(768) column would reject it anyway, but this
      // gives a much clearer error message about *why*.
      throw new AIProviderError(
        `Embedding provider returned a ${values.length}-dimension vector, ` +
          `but the database column and app configuration expect ` +
          `${this.embeddingDimensions}. Check EMBEDDING_MODEL and the ` +
          `output_dimensionality request parameter.`,
        "invalid_request",
        data,
      );
    }

    return values;
  }
}
