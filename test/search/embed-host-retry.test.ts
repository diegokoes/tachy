import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const threads = vi.hoisted(() => [] as EventEmitter[]);

vi.mock("node:worker_threads", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  class Worker extends Emitter {
    constructor() {
      super();
      threads.push(this);
    }
    postMessage() {}
    async terminate() {
      return 0;
    }
  }
  return { Worker, parentPort: null };
});

const { loadRetryDelayMs, startEmbedHost } =
  await import("../../packages/core/src/search/embed-host");

beforeEach(() => {
  threads.length = 0;
  vi.useFakeTimers();
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const latestThread = () => threads[threads.length - 1];

describe("embedding model load retries", () => {
  it("doubles the wait from one second", () => {
    expect([1, 2, 3, 4, 5].map(loadRetryDelayMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000,
    ]);
  });

  it("is fatal after six failed loads spread over 31 seconds", async () => {
    const onFatal = vi.fn();
    const host = startEmbedHost({ onFatal });
    const waitsMs = [1_000, 2_000, 4_000, 8_000, 16_000];
    for (const waitMs of waitsMs) {
      const started = threads.length;
      latestThread().emit("exit", 1);
      vi.advanceTimersByTime(waitMs - 1);
      expect(threads).toHaveLength(started);
      vi.advanceTimersByTime(1);
      expect(threads).toHaveLength(started + 1);
    }
    expect(onFatal).not.toHaveBeenCalled();
    latestThread().emit("exit", 1);
    expect(onFatal).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(threads).toHaveLength(6);
    await host.stop();
  });

  it("restarts a thread that was serving after one second, without counting it", async () => {
    const onFatal = vi.fn();
    const host = startEmbedHost({ onFatal, maxLoadFailures: 2 });
    latestThread().emit("exit", 1);
    vi.advanceTimersByTime(1_000);
    for (let death = 0; death < 3; death++) {
      latestThread().emit("message", { type: "ready" });
      const started = threads.length;
      latestThread().emit("exit", 1);
      vi.advanceTimersByTime(1_000);
      expect(threads).toHaveLength(started + 1);
    }
    expect(onFatal).not.toHaveBeenCalled();
    await host.stop();
  });
});
