import { AIProviderError } from "@/lib/ai";

/**
 * Converts anything that can go wrong calling Gemini into a short,
 * user-safe message — mirroring the shape of lib/auth/errors.ts.
 * Never returns a raw provider message, stack trace, or environment
 * variable name; those are logged server-side (by the caller) but
 * never sent to the client.
 */
export function getAIErrorMessage(error: unknown): string {
  if (error instanceof AIProviderError) {
    switch (error.kind) {
      case "rate_limit":
        return "AI features are getting a lot of use right now. Please wait a moment and try again.";
      case "timeout":
        return "The AI took too long to respond. Please try again.";
      case "invalid_request":
        return "The AI couldn't process this note. Please try again.";
      default:
        return "Something went wrong contacting the AI provider. Please try again.";
    }
  }

  if (error instanceof Error && /Missing required environment variable/.test(error.message)) {
    return "AI features aren't configured for this environment yet.";
  }

  if (error instanceof SyntaxError) {
    // JSON.parse failure on the model's response.
    return "The AI returned an unexpected response. Please try again.";
  }

  if (
    error instanceof TypeError ||
    (error instanceof Error && /fetch|network/i.test(error.message))
  ) {
    return "Couldn't reach the AI provider. Check your connection and try again.";
  }

  return "Something went wrong. Please try again.";
}
