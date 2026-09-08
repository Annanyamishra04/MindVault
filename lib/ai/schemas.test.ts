import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aiSummaryResultSchema,
  aiKeyPointsResultSchema,
  aiTagsResultSchema,
  aiRewriteResultSchema,
  rewriteModeSchema,
} from "@/lib/ai/schemas";

test("aiSummaryResultSchema accepts a well-formed summary", () => {
  const parsed = aiSummaryResultSchema.parse({ summary: "A short summary." });
  assert.equal(parsed.summary, "A short summary.");
});

test("aiSummaryResultSchema rejects a missing summary field", () => {
  assert.throws(() => aiSummaryResultSchema.parse({}));
});

test("aiSummaryResultSchema rejects the wrong type", () => {
  assert.throws(() => aiSummaryResultSchema.parse({ summary: 42 }));
});

test("aiSummaryResultSchema rejects an empty string", () => {
  assert.throws(() => aiSummaryResultSchema.parse({ summary: "   " }));
});

test("aiKeyPointsResultSchema accepts an array of strings", () => {
  const parsed = aiKeyPointsResultSchema.parse({ keyPoints: ["one", "two"] });
  assert.deepEqual(parsed.keyPoints, ["one", "two"]);
});

test("aiKeyPointsResultSchema rejects a non-array keyPoints", () => {
  assert.throws(() => aiKeyPointsResultSchema.parse({ keyPoints: "one, two" }));
});

test("aiKeyPointsResultSchema rejects array items of the wrong type", () => {
  assert.throws(() => aiKeyPointsResultSchema.parse({ keyPoints: [1, 2, 3] }));
});

test("aiTagsResultSchema accepts an array of tag strings", () => {
  const parsed = aiTagsResultSchema.parse({ tags: ["react", "notes"] });
  assert.deepEqual(parsed.tags, ["react", "notes"]);
});

test("aiRewriteResultSchema requires a non-empty rewritten string", () => {
  assert.throws(() => aiRewriteResultSchema.parse({ rewritten: "" }));
  const parsed = aiRewriteResultSchema.parse({ rewritten: "Rewritten text." });
  assert.equal(parsed.rewritten, "Rewritten text.");
});

test("rewriteModeSchema accepts only the three supported modes", () => {
  assert.equal(rewriteModeSchema.parse("improve"), "improve");
  assert.equal(rewriteModeSchema.parse("concise"), "concise");
  assert.equal(rewriteModeSchema.parse("professional"), "professional");
});

test("rewriteModeSchema rejects an unsupported mode", () => {
  assert.throws(() => rewriteModeSchema.parse("expand"));
  assert.throws(() => rewriteModeSchema.parse("bullets"));
  assert.throws(() => rewriteModeSchema.parse(""));
});
