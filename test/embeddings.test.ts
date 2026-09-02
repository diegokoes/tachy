import { describe, expect, it } from "vitest";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  EMBEDDING_SPEC,
  embedPassage,
  embedPassages,
  embedQuery,
  toVectorLiteral,
} from "@tachy/core";

/**
 * No database here. What these guard is the layer whose failures are silent:
 * a batch that comes back in the wrong order, or a spec that disagrees with the
 * vector(N) columns, both produce vectors that are the right shape and the
 * wrong meaning — search then ranks nonsense above matches with nothing failing.
 */
describe("embedPassages", () => {
  it("returns nothing for nothing", async () => {
    expect(await embedPassages([])).toEqual([]);
  });

  /**
   * The batcher sorts by length to avoid paying for padding, so the mapping
   * back to input order is the part that can silently break. Lengths here are
   * deliberately shuffled and span a batch boundary.
   */
  it("answers in the caller's order, not the order it batched in", async () => {
    const texts = Array.from({ length: 35 }, (_, i) =>
      // Lengths run long -> short, so sorted order is the exact reverse.
      "printer stops mid-batch ".repeat(35 - i),
    );
    const batched = await embedPassages(texts);
    expect(batched).toHaveLength(texts.length);

    for (const i of [0, 17, 34]) {
      const single = await embedPassage(texts[i]);
      expect(batched[i].length).toBe(EMBEDDING_DIM);
      // Same text, same vector, whatever it was batched beside.
      for (let k = 0; k < EMBEDDING_DIM; k++)
        expect(batched[i][k]).toBeCloseTo(single[k], 5);
    }
  });

  it("gives identical text identical vectors", async () => {
    const [a, b] = await embedPassages([
      "queue depth grows",
      "queue depth grows",
    ]);
    expect(a).toEqual(b);
  });

  it("produces unit vectors of the schema's width", async () => {
    const [v] = await embedPassages(["scanner returns ECONNREFUSED"]);
    expect(v).toHaveLength(EMBEDDING_DIM);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 3);
  });
});

describe("the model spec", () => {
  /**
   * The vector(768) columns in db/schema.sql and this constant have to move
   * together; embeddings.ts throws on import if they do not, which is why this
   * asserts the pair rather than either alone.
   */
  it("matches the width the schema stores", () => {
    expect(EMBEDDING_SPEC.dim).toBe(EMBEDDING_DIM);
    expect(EMBEDDING_DIM).toBe(768);
  });

  it("names a model it has pooling and prefixes for", () => {
    expect(["cls", "mean"]).toContain(EMBEDDING_SPEC.pooling);
    expect(EMBEDDING_SPEC.maxChars).toBeGreaterThan(0);
    expect(EMBEDDING_MODEL).toBeTruthy();
  });

  /** Truncation is silent by design; what matters is that it happens at all. */
  it("truncates a passage past maxChars instead of overrunning the window", async () => {
    const long = "x".repeat(EMBEDDING_SPEC.maxChars + 5000);
    const [a] = await embedPassages([long]);
    const [b] = await embedPassages([long.slice(0, EMBEDDING_SPEC.maxChars)]);
    expect(a).toEqual(b);
  });
});

describe("query vs passage", () => {
  it("embeds a query into the same space as its passage", async () => {
    const q = await embedQuery("printer stops mid-batch");
    const p = await embedPassage("printer stops mid-batch");
    expect(q).toHaveLength(EMBEDDING_DIM);
    const cos = q.reduce((s, x, i) => s + x * p[i], 0);
    expect(cos).toBeGreaterThan(0.9);
  });
});

describe("toVectorLiteral", () => {
  it("writes the form pgvector parses", () => {
    expect(toVectorLiteral([1, -0.5, 0])).toBe("[1,-0.5,0]");
  });

  it("round-trips a real vector's width", async () => {
    const v = await embedPassage("ink level reads negative");
    const literal = toVectorLiteral(v);
    expect(literal.startsWith("[")).toBe(true);
    expect(literal.endsWith("]")).toBe(true);
    expect(literal.slice(1, -1).split(",")).toHaveLength(EMBEDDING_DIM);
  });
});
