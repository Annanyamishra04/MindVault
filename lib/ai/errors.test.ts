import { test } from "node:test";
import assert from "node:assert/strict";
import { AIProviderError } from "@/lib/ai";
import { getAIErrorMessage } from "@/lib/ai/errors";

test("maps a rate_limit AIProviderError to a friendly, non-leaking message", () => {
  const msg = getAIErrorMessage(new AIProviderError("upstream said 429", "rate_limit"));
  assert.match(msg, /busy|wait/i);
  assert.doesNotMatch(msg, /429/);
});

test("maps a timeout AIProviderError to a friendly message", () => {
  const msg = getAIErrorMessage(new AIProviderError("took too long", "timeout"));
  assert.match(msg, /too long|try again/i);
});

test("maps an invalid_request AIProviderError to a friendly message", () => {
  const msg = getAIErrorMessage(new AIProviderError("bad request", "invalid_request"));
  assert.match(msg, /couldn't process/i);
});

test("maps an unknown-kind AIProviderError to the generic provider message", () => {
  const msg = getAIErrorMessage(new AIProviderError("mystery failure", "unknown"));
  assert.match(msg, /went wrong contacting the ai provider/i);
});

test("never leaks the missing-env-var name to the user", () => {
  const msg = getAIErrorMessage(new Error("Missing required environment variable: AI_API_KEY"));
  assert.doesNotMatch(msg, /AI_API_KEY/);
  assert.match(msg, /(not|aren't) configured/i);
});

test("maps a JSON parse failure (SyntaxError) to a friendly message", () => {
  let syntaxError: SyntaxError;
  try {
    JSON.parse("not json");
    throw new Error("unreachable");
  } catch (e) {
    syntaxError = e as SyntaxError;
  }
  const msg = getAIErrorMessage(syntaxError);
  assert.match(msg, /unexpected response/i);
});

test("maps a network TypeError (e.g. fetch failure) to a friendly message", () => {
  const msg = getAIErrorMessage(new TypeError("fetch failed"));
  assert.match(msg, /couldn't reach/i);
});

test("falls back to a generic message for anything else", () => {
  const msg = getAIErrorMessage("a plain string, not an Error at all");
  assert.match(msg, /something went wrong/i);
});
