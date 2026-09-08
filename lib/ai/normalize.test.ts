import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeKeyPoints, normalizeSuggestedTags, parseJsonResponse } from "@/lib/ai/normalize";
import { MAX_KEY_POINTS, MAX_TAG_SUGGESTIONS } from "@/lib/ai/limits";

test("normalizeKeyPoints trims, drops empties, and caps length", () => {
  const input = [
    "  First point.  ",
    "",
    "   ",
    "Second point.",
    "Third point.",
    "Fourth point.",
    "Fifth point.",
    "Sixth point.",
    "Seventh point — should be cut off by the cap.",
  ];
  const result = normalizeKeyPoints(input);
  assert.equal(result.length, MAX_KEY_POINTS);
  assert.equal(result[0], "First point.");
  assert.ok(!result.includes(""));
});

test("normalizeKeyPoints removes case-insensitive duplicates", () => {
  const result = normalizeKeyPoints(["Ship the release", "ship the release", "SHIP THE RELEASE"]);
  assert.equal(result.length, 1);
});

test("normalizeSuggestedTags dedupes case-insensitively and keeps first casing", () => {
  const result = normalizeSuggestedTags(["React", "react", "REACT", "typescript"]);
  assert.deepEqual(result, ["React", "typescript"]);
});

test("normalizeSuggestedTags drops tags that fail tagNameSchema", () => {
  const tooLong = "x".repeat(51); // tagNameSchema caps at 50 chars
  const withNewline = "line1\nline2";
  const result = normalizeSuggestedTags(["good-tag", tooLong, withNewline, "", "   "]);
  assert.deepEqual(result, ["good-tag"]);
});

test("normalizeSuggestedTags caps at MAX_TAG_SUGGESTIONS", () => {
  const many = Array.from({ length: MAX_TAG_SUGGESTIONS + 5 }, (_, i) => `tag-${i}`);
  const result = normalizeSuggestedTags(many);
  assert.equal(result.length, MAX_TAG_SUGGESTIONS);
});

test("parseJsonResponse parses plain JSON", () => {
  const parsed = parseJsonResponse('{"summary": "hello"}');
  assert.deepEqual(parsed, { summary: "hello" });
});

test("parseJsonResponse strips a ```json fence", () => {
  const raw = '```json\n{"summary": "hello"}\n```';
  const parsed = parseJsonResponse(raw);
  assert.deepEqual(parsed, { summary: "hello" });
});

test("parseJsonResponse strips a bare ``` fence", () => {
  const raw = '```\n{"tags": ["a", "b"]}\n```';
  const parsed = parseJsonResponse(raw);
  assert.deepEqual(parsed, { tags: ["a", "b"] });
});

test("parseJsonResponse throws on genuinely malformed JSON", () => {
  assert.throws(() => parseJsonResponse("Sure! Here are some tags: a, b, c"), SyntaxError);
});
