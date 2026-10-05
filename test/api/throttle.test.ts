import { afterEach, describe, expect, it, vi } from "vitest";
import { failureThrottle } from "../../packages/api/src/throttle";

afterEach(() => vi.useRealTimers());

describe("failure throttle", () => {
  it("blocks a key at its limit and lets it back in after the window", () => {
    vi.useFakeTimers();
    const t = failureThrottle(3, 60_000);
    t.fail("a");
    t.fail("a");
    expect(t.blocked("a")).toBe(false);
    t.fail("a");
    expect(t.blocked("a")).toBe(true);
    expect(t.blocked("b")).toBe(false);

    vi.advanceTimersByTime(60_001);
    expect(t.blocked("a")).toBe(false);
    t.fail("a");
    expect(t.blocked("a")).toBe(false);
  });

  it("stays bounded when every key is new", () => {
    vi.useFakeTimers();
    const t = failureThrottle(1, 60_000, 3);
    for (const key of ["a", "b", "c", "d"]) t.fail(key);
    expect(t.blocked("a")).toBe(false);
    expect(t.blocked("d")).toBe(true);

    vi.advanceTimersByTime(60_001);
    t.fail("e");
    expect(t.blocked("b")).toBe(false);
    expect(t.blocked("e")).toBe(true);
  });
});
