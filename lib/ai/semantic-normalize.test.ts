import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  clampSimilarity,
  similarityToPercent,
  buildResultSnippet,
  normalizeMatches,
} from "@/lib/ai/semantic-normalize";

describe("clampSimilarity", () => {
  test("passes through an in-range value", () => {
    assert.equal(clampSimilarity(0.42), 0.42);
  });

  test("clamps above 1", () => {
    assert.equal(clampSimilarity(1.2), 1);
  });

  test("clamps below 0", () => {
    assert.equal(clampSimilarity(-0.3), 0);
  });

  test("treats NaN/Infinity as 0 rather than propagating them", () => {
    assert.equal(clampSimilarity(NaN), 0);
    assert.equal(clampSimilarity(Infinity), 0);
    assert.equal(clampSimilarity(-Infinity), 0);
  });
});

describe("similarityToPercent", () => {
  test("rounds to the nearest whole percent", () => {
    assert.equal(similarityToPercent(0.821), 82);
    assert.equal(similarityToPercent(0.825), 83);
  });

  test("clamps out-of-range input before converting", () => {
    assert.equal(similarityToPercent(1.5), 100);
    assert.equal(similarityToPercent(-1), 0);
  });
});

describe("buildResultSnippet", () => {
  test("prefers the summary when one exists", () => {
    const snippet = buildResultSnippet("Raw note content here", "A short AI summary.");
    assert.equal(snippet, "A short AI summary.");
  });

  test("falls back to content when there is no summary", () => {
    const snippet = buildResultSnippet("Raw note content here", null);
    assert.equal(snippet, "Raw note content here");
  });

  test("falls back to content when summary is empty/whitespace", () => {
    const snippet = buildResultSnippet("Raw note content here", "   ");
    assert.equal(snippet, "Raw note content here");
  });

  test("collapses internal newlines/whitespace to single spaces", () => {
    const snippet = buildResultSnippet("Line one\n\nLine two\tLine three", null);
    assert.equal(snippet, "Line one Line two Line three");
  });

  test("truncates with an ellipsis past maxChars", () => {
    const long = "a".repeat(200);
    const snippet = buildResultSnippet(long, null, 160);
    assert.equal(snippet.length, 161); // 160 chars + the ellipsis character
    assert.ok(snippet.endsWith("…"));
  });

  test("does not truncate content at or under maxChars", () => {
    const exact = "a".repeat(160);
    const snippet = buildResultSnippet(exact, null, 160);
    assert.equal(snippet, exact);
  });
});

describe("normalizeMatches", () => {
  test("maps RPC rows into the display shape, rounding similarity", () => {
    const results = normalizeMatches([
      { note_id: "n1", title: "React interview prep", similarity: 0.734, summary: "Prep notes." },
    ]);
    assert.deepEqual(results, [
      { noteId: "n1", title: "React interview prep", snippet: "Prep notes.", similarityPercent: 73 },
    ]);
  });

  test("drops rows missing a note_id or title", () => {
    const results = normalizeMatches([
      { note_id: "", title: "Has no id", similarity: 0.9 },
      // @ts-expect-error deliberately malformed for the defensive-drop test
      { note_id: "n2", title: undefined, similarity: 0.5 },
      { note_id: "n3", title: "Valid row", similarity: 0.5 },
    ]);
    assert.deepEqual(
      results.map((r) => r.noteId),
      ["n3"],
    );
  });

  test("falls back to 'Untitled note' for a blank (but present) title", () => {
    const results = normalizeMatches([{ note_id: "n1", title: "   ", similarity: 0.5 }]);
    assert.equal(results[0].title, "Untitled note");
  });

  test("handles rows with no content or summary (match_related_notes shape)", () => {
    const results = normalizeMatches([{ note_id: "n1", title: "Title", similarity: 0.5 }]);
    assert.equal(results[0].snippet, "");
  });

  test("preserves RPC ordering (already sorted by similarity)", () => {
    const results = normalizeMatches([
      { note_id: "n1", title: "First", similarity: 0.9 },
      { note_id: "n2", title: "Second", similarity: 0.5 },
    ]);
    assert.deepEqual(
      results.map((r) => r.noteId),
      ["n1", "n2"],
    );
  });
});
