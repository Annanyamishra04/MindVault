import type { AIProvider } from "./provider";
import { GeminiProvider } from "./gemini";

/**
 * Single wiring point for the active AI provider. Every other module
 * imports `getAIProvider()` from here rather than instantiating a
 * provider directly, so switching vendors is a one-line change.
 */
let cachedProvider: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (!cachedProvider) {
    // Only one provider is implemented today (Gemini), but this switch
    // is where a second provider would be selected via an env var,
    // e.g. AI_PROVIDER=openai.
    cachedProvider = new GeminiProvider();
  }
  return cachedProvider;
}

export type {
  AIProvider,
  GenerateTextOptions,
  GenerateTextResult,
  EmbeddingTaskType,
} from "./provider";
export { AIProviderError } from "./provider";
