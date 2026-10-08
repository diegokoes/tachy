import { describe, expect, it } from "vitest";
import { EmbedQueue } from "@tachy/core/search";

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
    const runner = recorder();
    const queue = new EmbedQueue(runner.run, {
      passageBatch: 2,
      queryBatch: 32,
    });
    const texts = ["aaaa", "a", "aaa", "aa", "aaaaa"];
    const answers = await queue.embed("passage", texts);
    expect(answers).toEqual([[4], [1], [3], [2], [5]]);
    expect(runner.batches).toEqual([["a", "aa"], ["aaa", "aaaa"], ["aaaaa"]]);
  });

  it("closes a passage batch at its byte budget, and never leaves one empty", async () => {
    const runner = recorder();
    const queue = new EmbedQueue(runner.run, {
      passageBatch: 8,
      queryBatch: 32,
      batchBytes: 10,
    });
    const texts = ["aaaa", "bbbb", "cccc", "d".repeat(25), "ee"];
    const answers = await queue.embed("passage", texts);
    expect(answers).toEqual([[4], [4], [4], [25], [2]]);
    expect(runner.batches).toEqual([
      ["ee", "aaaa", "bbbb"],
      ["cccc"],
      ["d".repeat(25)],
    ]);
  });

  // Three bytes a character and more than one token: counted in characters,
  // these three would share a batch.
  it("counts the budget in bytes, so a dense script fills it sooner", async () => {
    const runner = recorder();
    const queue = new EmbedQueue(runner.run, {
      passageBatch: 8,
      queryBatch: 32,
      batchBytes: 10,
    });
    await queue.embed("passage", ["扫描", "离线", "队列"]);
    expect(runner.batches).toEqual([["扫描"], ["离线"], ["队列"]]);
  });

  it("holds a query batch to the same budget", async () => {
    const runner = recorder();
    const queue = new EmbedQueue(runner.run, {
      passageBatch: 8,
      queryBatch: 32,
      batchBytes: 10,
    });
    runner.hold();
    const first = queue.embed("query", ["q0"]);
    await flush();
    const rest = [
      queue.embed("query", ["aaaa"]),
      queue.embed("query", ["bbbb"]),
      queue.embed("query", ["cccc"]),
      queue.embed("query", ["d".repeat(25)]),
    ];
    runner.open();
    await Promise.all([first, ...rest]);
    expect(runner.batches).toEqual([
      ["q0"],
      ["aaaa", "bbbb"],
      ["cccc"],
      ["d".repeat(25)],
    ]);
  });

  it("runs a waiting query before the next passage batch", async () => {
    const runner = recorder();
    const queue = new EmbedQueue(runner.run, {
      passageBatch: 1,
      queryBatch: 32,
    });
    runner.hold();
    const passages = queue.embed("passage", ["p1", "p2", "p3"], "indexer");
    await flush();
    const query = queue.embed("query", ["q"]);
    runner.open();
    runner.hold();
    await flush();
    runner.open();
    await Promise.all([passages, query]);
    expect(runner.batches.map((b) => b.join())).toEqual([
      "p1",
      "q",
      "p2",
      "p3",
    ]);
  });

  it("takes passage batches from each caller in turn", async () => {
    const runner = recorder();
    const queue = new EmbedQueue(runner.run, {
      passageBatch: 1,
      queryBatch: 32,
    });
    runner.hold();
    const big = queue.embed("passage", ["b1", "b2", "b3"], "big");
    const small = queue.embed("passage", ["s1"], "small");
    runner.open();
    await Promise.all([big, small]);
    expect(runner.batches.map((b) => b.join())).toEqual([
      "b1",
      "s1",
      "b2",
      "b3",
    ]);
  });

  it("fails only the job whose batch failed", async () => {
    const queue = new EmbedQueue(
      async (texts) => {
        if (texts.includes("bad")) throw new Error("boom");
        return texts.map(() => [1]);
      },
      { passageBatch: 8, queryBatch: 32 },
    );
    const bad = queue.embed("passage", ["bad"], "a");
    const good = queue.embed("passage", ["good"], "b");
    await expect(bad).rejects.toThrow("boom");
    await expect(good).resolves.toEqual([[1]]);
    expect(queue.depth).toMatchObject({
      queries: 0,
      passages: 0,
      running: false,
    });
  });

  it("serves low-priority passages only when no normal passage waits", async () => {
    const runner = recorder();
    const queue = new EmbedQueue(runner.run, {
      passageBatch: 1,
      queryBatch: 32,
    });
    runner.hold();
    const low = queue.embed("passage", ["l1", "l2"], "worker", "low");
    await flush();
    const normal = queue.embed("passage", ["n1", "n2"], "turn");
    runner.open();
    await Promise.all([low, normal]);
    expect(runner.batches.map((b) => b.join())).toEqual([
      "l1",
      "n1",
      "n2",
      "l2",
    ]);
  });
});
