/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * jsdom has no matchMedia, and every motion helper asks it the same question
 * before it does anything: does this reader want motion at all.
 */
let reduce = false;

vi.stubGlobal("matchMedia", (q: string) => ({
  matches: q.includes("prefers-reduced-motion") ? reduce : true,
  media: q,
  addEventListener() {},
  removeEventListener() {},
}));

const { growBar } = await import("../../packages/web/src/lib/motion");

beforeEach(() => {
  reduce = false;
  document.body.innerHTML = "";
});

describe("growBar", () => {
  /* The reduced-motion path is not "no animation" but "the end state,
     immediately" — a gauge that never fills reads as a gauge at zero. */
  it("arrives at its height with motion off", () => {
    reduce = true;
    const el = document.createElement("span");
    growBar(el, { pct: 40 });
    expect(el.style.height).toBe("40%");
  });

  it("updates in place once it has been drawn", () => {
    reduce = true;
    const el = document.createElement("span");
    const handle = growBar(el, { pct: 10 });
    handle.update({ pct: 90 });
    expect(el.style.height).toBe("90%");
  });
});
