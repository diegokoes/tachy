import { describe, expect, it } from "vitest";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  EMBEDDING_SPEC,
  embedPassage,
  embedPassages,
  embedQuery,
  toVectorLiteral,
} from "@tachy/core/search";
import {
  EMBEDDING_MODELS,
  leadingUnit,
  vectorRows,
} from "../../packages/core/src/search/model";

// No database. These guard failures that raise nothing: a batch answered in
// the wrong order, or a spec that disagrees with the vector(N) columns, gives
// vectors of the right shape and the wrong meaning.
describe("embedPassages", () => {
  it("returns nothing for nothing", async () => {
    expect(await embedPassages([])).toEqual([]);
  });

  // The batcher sorts by length to avoid padding, so the lengths here differ
  // and span a batch boundary.
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

  // The first two texts differ only beyond the cap; the third differs before it.
  it("reads no further than the model's token cap", async () => {
    const shared = "word ".repeat(EMBEDDING_SPEC.maxTokens + 50);
    expect(shared.length + 400).toBeLessThan(EMBEDDING_SPEC.maxChars);
    const [alpha, omega, omegaFirst] = await Promise.all([
      embedPassage(shared + "alpha ".repeat(60)),
      embedPassage(shared + "omega ".repeat(60)),
      embedPassage("omega ".repeat(60) + shared),
    ]);
    const cos = (x: number[], y: number[]) =>
      x.reduce((s, v, i) => s + v * y[i], 0);
    expect(cos(alpha, omega)).toBeCloseTo(1, 4);
    expect(cos(alpha, omegaFirst)).toBeLessThan(0.999);
  });

  it("produces unit vectors of the schema's width", async () => {
    const [vector] = await embedPassages(["scanner returns ECONNREFUSED"]);
    expect(vector).toHaveLength(EMBEDDING_DIM);
    const norm = Math.sqrt(vector.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 3);
  });
});

describe("the model spec", () => {
  // The vector(768) columns in db/schema.sql and the constant move together,
  // so the pair is asserted.
  it("matches the width the schema stores", () => {
    expect(EMBEDDING_SPEC.dim).toBe(EMBEDDING_DIM);
    expect(EMBEDDING_DIM).toBe(768);
  });

  it("names a model it has pooling and prefixes for", () => {
    expect(["cls", "mean", "last_token"]).toContain(EMBEDDING_SPEC.pooling);
    expect(EMBEDDING_SPEC.maxChars).toBeGreaterThan(0);
    expect(EMBEDDING_MODEL).toBeTruthy();
  });

  it("truncates a passage past maxChars instead of overrunning the window", async () => {
    const long = "x".repeat(EMBEDDING_SPEC.maxChars + 5000);
    const [a] = await embedPassages([long]);
    const [b] = await embedPassages([long.slice(0, EMBEDDING_SPEC.maxChars)]);
    expect(a).toEqual(b);
  });
});

describe("the model registry", () => {
  // A variant's key is its stamp and names no repository, so the files have
  // to be named beside it.
  it("names the repository of every variant", () => {
    for (const [name, spec] of Object.entries(EMBEDDING_MODELS))
      if (name.includes(":")) expect(spec.source, name).toBeTruthy();
  });

  // An export held outside the model's own repository is one upload away
  // from other vectors under the same name.
  it("reads the default model's export at one commit", () => {
    expect(EMBEDDING_MODELS["lightonai/mDenseOn"].revision).toMatch(
      /^[0-9a-f]{40}$/,
    );
  });

  it("gives an int8 file a name of its own", () => {
    for (const [name, spec] of Object.entries(EMBEDDING_MODELS))
      expect(name.endsWith(":q8"), name).toBe(spec.dtype === "q8");
  });
});

describe("leadingUnit", () => {
  it("keeps the leading values of each row, at unit length", () => {
    const wide = new Float32Array([3, 4, 9, 9, 0, 5, 7, 7]);
    const cut = leadingUnit(wide, 4, 2);
    expect(Array.from(cut)).toEqual([
      expect.closeTo(0.6, 6),
      expect.closeTo(0.8, 6),
      0,
      1,
    ]);
  });

  it("leaves a row of zeros as it is", () => {
    expect(Array.from(leadingUnit(new Float32Array(4), 4, 2))).toEqual([0, 0]);
  });
});

describe("vectorRows", () => {
  it("splits the values into one vector a row", () => {
    const data = new Float32Array(2 * EMBEDDING_DIM);
    data[0] = 1;
    data[EMBEDDING_DIM] = 2;
    const rows = vectorRows({ data, rows: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(EMBEDDING_DIM);
    expect([rows[0][0], rows[1][0]]).toEqual([1, 2]);
  });
});

describe("query vs passage", () => {
  it("embeds a query into the same space as its passage", async () => {
    const query = await embedQuery("printer stops mid-batch");
    const passage = await embedPassage("printer stops mid-batch");
    expect(query).toHaveLength(EMBEDDING_DIM);
    const cos = query.reduce((s, x, i) => s + x * passage[i], 0);
    // Not 1: a model with a prefix per side reads the two as different texts.
    expect(cos).toBeGreaterThan(EMBEDDING_SPEC.semCeil);
  });
});

describe("toVectorLiteral", () => {
  it("writes the form pgvector parses", () => {
    expect(toVectorLiteral([1, -0.5, 0])).toBe("[1,-0.5,0]");
  });

  it("round-trips a real vector's width", async () => {
    const vector = await embedPassage("ink level reads negative");
    const literal = toVectorLiteral(vector);
    expect(literal.startsWith("[")).toBe(true);
    expect(literal.endsWith("]")).toBe(true);
    expect(literal.slice(1, -1).split(",")).toHaveLength(EMBEDDING_DIM);
  });
});
