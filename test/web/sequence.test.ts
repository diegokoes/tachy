import { describe, expect, it } from "vitest";
import { createSequence } from "../../packages/web/src/resource.svelte";

// The guard the hand-written views use instead of `createResource`. It stops a
// slow response landing after a fast one asked for later: navigating A → B, A's
// fetch finishes second and would put A back on screen.
describe("createSequence", () => {
  it("is current until a newer load starts", () => {
    const current = createSequence();
    const first = current();
    expect(first()).toBe(true);

    const second = current();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("keeps the newest current however many overlap", () => {
    const current = createSequence();
    const guards = [current(), current(), current()];
    expect(guards.map((g) => g())).toEqual([false, false, true]);
  });

  it("tracks each sequence separately", () => {
    const a = createSequence();
    const b = createSequence();
    const aFirst = a();
    b();
    // b starting a load says nothing about a's.
    expect(aFirst()).toBe(true);
  });
});
