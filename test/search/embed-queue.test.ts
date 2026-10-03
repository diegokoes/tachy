import { describe, expect, it } from "vitest";
import { EmbedQueue } from "@tachy/core";

/** A runner that records each batch and answers with each text's length. */
function recorder() {
  const batches: string[][] = [];
  let release: (() => void) | undefined;
  let gate = Promise.resolve();
  return {
    batches,
    hold() {
      gate = new Promise((r) => (release = r));
    },
    open: () => release?.(),
    run: async (texts: string[]) => {
      batches.push(texts);
      await gate;
      return texts.map((t) => [t.length]);
    },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

describe("EmbedQueue", () => {
  it("answers passages in the caller's order after batching by length", async () => {
    const r = recorder();
    const q = new EmbedQueue(r.run, { passageBatch: 2, queryBatch: 32 });
    const texts = ["aaaa", "a", "aaa", "aa", "aaaaa"];
    const out = await q.embed("passage", texts);
    expect(out).toEqual([[4], [1], [3], [2], [5]]);
    expect(r.batches).toEqual([["a", "aa"], ["aaa", "aaaa"], ["aaaaa"]]);
  });

  it("runs a waiting query before the next passage batch", async () => {
    const r = recorder();
    const q = new EmbedQueue(r.run, { passageBatch: 1, queryBatch: 32 });
    r.hold();
    const passages = q.embed("passage", ["p1", "p2", "p3"], "indexer");
    await flush();
    const query = q.embed("query", ["q"]);
    r.open();
    r.hold();
    await flush();
    r.open();
    await Promise.all([passages, query]);
    expect(r.batches.map((b) => b.join())).toEqual(["p1", "q", "p2", "p3"]);
  });

  it("takes passage batches from each caller in turn", async () => {
    const r = recorder();
    const q = new EmbedQueue(r.run, { passageBatch: 1, queryBatch: 32 });
    r.hold();
    const big = q.embed("passage", ["b1", "b2", "b3"], "big");
    const small = q.embed("passage", ["s1"], "small");
    r.open();
    await Promise.all([big, small]);
    expect(r.batches.map((b) => b.join())).toEqual(["b1", "s1", "b2", "b3"]);
  });

  it("fails only the job whose batch failed", async () => {
    const q = new EmbedQueue(
      async (texts) => {
        if (texts.includes("bad")) throw new Error("boom");
        return texts.map(() => [1]);
      },
      { passageBatch: 8, queryBatch: 32 },
    );
    const bad = q.embed("passage", ["bad"], "a");
    const good = q.embed("passage", ["good"], "b");
    await expect(bad).rejects.toThrow("boom");
    await expect(good).resolves.toEqual([[1]]);
    expect(q.depth).toMatchObject({ queries: 0, passages: 0, running: false });
  });

  it("serves low-priority passages only when no normal passage waits", async () => {
    const r = recorder();
    const q = new EmbedQueue(r.run, { passageBatch: 1, queryBatch: 32 });
    r.hold();
    const low = q.embed("passage", ["l1", "l2"], "worker", "low");
    await flush();
    const normal = q.embed("passage", ["n1", "n2"], "turn");
    r.open();
    await Promise.all([low, normal]);
    expect(r.batches.map((b) => b.join())).toEqual(["l1", "n1", "n2", "l2"]);
  });
});
