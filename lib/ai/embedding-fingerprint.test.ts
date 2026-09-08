import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeContentFingerprint,
  isEmbeddingCurrent,
  isInputTooLargeForEmbedding,
} from "@/lib/ai/embedding-fingerprint";

describe("computeContentFingerprint", () => {
  test("is deterministic for the same title + content", () => {
    const a = computeContentFingerprint("Interview prep", "Practice React questions");
    const b = computeContentFingerprint("Interview prep", "Practice React questions");
    assert.equal(a, b);
  });

  test("changes when content changes", () => {
    const a = computeContentFingerprint("Interview prep", "Practice React questions");
    const b = computeContentFingerprint("Interview prep", "Practice Vue questions");
    assert.notEqual(a, b);
  });

  test("changes when title changes", () => {
    const a = computeContentFingerprint("Interview prep", "Practice React questions");
    const b = computeContentFingerprint("Job prep", "Practice React questions");
    assert.notEqual(a, b);
  });

  test("does not collide across different title/content splits", () => {
    // Without a length-prefixed separator, ("a", "b|c") and ("a|b", "c")
    // could hash identically under a naive `${title}|${content}` join.
    const a = computeContentFingerprint("a", "b|c");
    const b = computeContentFingerprint("a|b", "c");
    assert.notEqual(a, b);
  });

  test("trims whitespace before hashing, matching how the app reads title/content", () => {
    const a = computeContentFingerprint("Interview prep", "Practice React questions");
    const b = computeContentFingerprint("  Interview prep  ", "  Practice React questions  ");
    assert.equal(a, b);
  });

  test("is not sensitive to internal whitespace differences it wasn't asked to normalize", () => {
    // Only leading/trailing whitespace is trimmed — internal whitespace
    // changes are real content changes and SHOULD produce a new hash.
    const a = computeContentFingerprint("Title", "one two");
    const b = computeContentFingerprint("Title", "one  two");
    assert.notEqual(a, b);
  });

  test("produces a 64-character hex sha256 digest", () => {
    const hash = computeContentFingerprint("t", "c");
    assert.match(hash, /^[0-9a-f]{64}$/);
  });
});

describe("isEmbeddingCurrent", () => {
  const config = { embeddingModel: "gemini-embedding-2", embeddingDimensions: 768 };
  const fingerprint = computeContentFingerprint("Title", "Content");

  test("false when there is no stored embedding", () => {
    assert.equal(isEmbeddingCurrent(null, fingerprint, config), false);
    assert.equal(isEmbeddingCurrent(undefined, fingerprint, config), false);
  });

  test("true when hash and model/dimensions all match", () => {
    const stored = { contentHash: fingerprint, embeddingModel: "gemini-embedding-2", embeddingDimensions: 768 };
    assert.equal(isEmbeddingCurrent(stored, fingerprint, config), true);
  });

  test("false when the content hash differs (note was edited)", () => {
    const stored = {
      contentHash: computeContentFingerprint("Title", "Old content"),
      embeddingModel: "gemini-embedding-2",
      embeddingDimensions: 768,
    };
    assert.equal(isEmbeddingCurrent(stored, fingerprint, config), false);
  });

  test("false when the embedding model differs, even with a matching hash", () => {
    const stored = { contentHash: fingerprint, embeddingModel: "some-other-model", embeddingDimensions: 768 };
    assert.equal(isEmbeddingCurrent(stored, fingerprint, config), false);
  });

  test("false when the dimensions differ, even with a matching hash and model", () => {
    const stored = { contentHash: fingerprint, embeddingModel: "gemini-embedding-2", embeddingDimensions: 1536 };
    assert.equal(isEmbeddingCurrent(stored, fingerprint, config), false);
  });
});

describe("isInputTooLargeForEmbedding", () => {
  test("false when comfortably under the limit", () => {
    assert.equal(isInputTooLargeForEmbedding("Title", "Some short content", 1000), false);
  });

  test("true when title + content together exceed the limit", () => {
    const content = "x".repeat(999);
    assert.equal(isInputTooLargeForEmbedding("Title", content, 1000), true);
  });

  test("trims before measuring, so surrounding whitespace can't tip it over the edge", () => {
    const content = "x".repeat(990);
    assert.equal(isInputTooLargeForEmbedding("     ", `  ${content}  `, 1000), false);
  });

  test("is exclusive at the boundary (exactly at the limit is not too large)", () => {
    const content = "x".repeat(995); // "Title" (5) + content (995) = 1000
    assert.equal(isInputTooLargeForEmbedding("Title", content, 1000), false);
  });
});
