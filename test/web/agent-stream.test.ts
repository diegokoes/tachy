/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const unauthorized = vi.fn();
vi.mock("../../packages/web/src/lib/session.svelte", () => ({
  onUnauthorized: unauthorized,
}));

const { chatStream } = await import("../../packages/web/src/lib/agent");

afterEach(() => {
  vi.unstubAllGlobals();
  unauthorized.mockClear();
});

/** An SSE body delivered in whatever chunks the test asks for. */
function sseResponse(chunks: string[], status = 200) {
  let cancelled = false;
  const queue = [...chunks];
  const body = {
    getReader: () => ({
      read: async () =>
        queue.length
          ? { done: false, value: new TextEncoder().encode(queue.shift()!) }
          : { done: true, value: undefined },
      cancel: async () => {
        cancelled = true;
      },
    }),
  };
  return {
    res: { ok: status === 200, status, body } as unknown as Response,
    wasCancelled: () => cancelled,
  };
}

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("chatStream", () => {
  it("yields one frame per event, across chunk boundaries", async () => {
    const whole =
      frame("start", { turnId: "t1" }) + frame("text", { text: "hi" });
    // Split mid-frame: the parser has to buffer rather than lose the tail.
    const { res } = sseResponse([whole.slice(0, 20), whole.slice(20)]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res),
    );

    const got = [];
    for await (const f of chatStream({ message: "x" } as never)) got.push(f);
    expect(got).toEqual([
      { event: "start", data: { turnId: "t1" } },
      { event: "text", data: { text: "hi" } },
    ]);
  });

  it("cancels the reader when the consumer stops early", async () => {
    const { res, wasCancelled } = sseResponse([
      frame("text", { text: "one" }),
      frame("text", { text: "two" }),
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res),
    );

    // A `break` leaves the generator suspended at its yield; without the
    // finally, the response body stays open for the life of the page.
    for await (const _ of chatStream({ message: "x" } as never)) break;
    expect(wasCancelled()).toBe(true);
  });

  it("reports a 401 as a sign-out rather than as a stream error", async () => {
    const { res } = sseResponse([], 401);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res),
    );

    const got = [];
    for await (const f of chatStream({ message: "x" } as never)) got.push(f);
    expect(got).toEqual([]);
    expect(unauthorized).toHaveBeenCalledOnce();
  });

  it("throws on any other failure", async () => {
    const { res } = sseResponse([], 500);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res),
    );
    await expect(async () => {
      for await (const _ of chatStream({ message: "x" } as never));
    }).rejects.toThrow("500");
  });
});
