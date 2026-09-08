import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { askQuestionSchema, ragAnswerResultSchema } from "@/lib/ai/schemas";
import { MAX_ASK_QUESTION_CHARS } from "@/lib/ai/limits";

describe("askQuestionSchema", () => {
  test("accepts a normal question", () => {
    const parsed = askQuestionSchema.parse("What did I decide about the roadmap?");
    assert.equal(parsed, "What did I decide about the roadmap?");
  });

  test("trims surrounding whitespace", () => {
    const parsed = askQuestionSchema.parse("  hello  ");
    assert.equal(parsed, "hello");
  });

  test("rejects an empty question", () => {
    assert.throws(() => askQuestionSchema.parse(""));
  });

  test("rejects a whitespace-only question", () => {
    assert.throws(() => askQuestionSchema.parse("   \n\t  "));
  });

  test("rejects a question over the max length", () => {
    assert.throws(() => askQuestionSchema.parse("a".repeat(MAX_ASK_QUESTION_CHARS + 1)));
  });

  test("accepts a question exactly at the max length", () => {
    const q = "a".repeat(MAX_ASK_QUESTION_CHARS);
    assert.equal(askQuestionSchema.parse(q), q);
  });
});

describe("ragAnswerResultSchema", () => {
  test("accepts a well-formed answer with citations", () => {
    const parsed = ragAnswerResultSchema.parse({
      answer: "You decided to ship in Q3.",
      citations: [{ sourceId: "S1" }, { sourceId: "S2" }],
    });
    assert.equal(parsed.answer, "You decided to ship in Q3.");
    assert.deepEqual(parsed.citations, [{ sourceId: "S1" }, { sourceId: "S2" }]);
  });

  test("accepts an answer with no citations (e.g. 'not covered' responses)", () => {
    const parsed = ragAnswerResultSchema.parse({
      answer: "Your notes don't cover this topic yet.",
      citations: [],
    });
    assert.deepEqual(parsed.citations, []);
  });

  test("rejects a missing answer field", () => {
    assert.throws(() => ragAnswerResultSchema.parse({ citations: [] }));
  });

  test("rejects an empty answer string", () => {
    assert.throws(() => ragAnswerResultSchema.parse({ answer: "   ", citations: [] }));
  });

  test("rejects a non-array citations field", () => {
    assert.throws(() =>
      ragAnswerResultSchema.parse({ answer: "hi", citations: "S1" }),
    );
  });

  test("rejects a citation missing sourceId", () => {
    assert.throws(() => ragAnswerResultSchema.parse({ answer: "hi", citations: [{}] }));
  });

  test("rejects a citation with a non-string sourceId", () => {
    assert.throws(() =>
      ragAnswerResultSchema.parse({ answer: "hi", citations: [{ sourceId: 1 }] }),
    );
  });

  test("missing citations field entirely is rejected (must be an explicit, possibly empty, array)", () => {
    assert.throws(() => ragAnswerResultSchema.parse({ answer: "hi" }));
  });
});
