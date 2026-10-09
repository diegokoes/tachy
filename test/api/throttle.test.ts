import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  callerAddress,
  failureThrottle,
} from "../../packages/api/src/throttle";

afterEach(() => vi.useRealTimers());

describe("failure throttle", () => {
  it("blocks a key at its limit and lets it back in after the window", () => {
    vi.useFakeTimers();
    const throttle = failureThrottle(3, 60_000);
    throttle.fail("a");
    throttle.fail("a");
    expect(throttle.blocked("a")).toBe(false);
    throttle.fail("a");
    expect(throttle.blocked("a")).toBe(true);
    expect(throttle.blocked("b")).toBe(false);

    vi.advanceTimersByTime(60_001);
    expect(throttle.blocked("a")).toBe(false);
    throttle.fail("a");
    expect(throttle.blocked("a")).toBe(false);
  });

  it("stays bounded when every key is new", () => {
    vi.useFakeTimers();
    const throttle = failureThrottle(1, 60_000, 3);
    for (const key of ["a", "b", "c", "d"]) throttle.fail(key);
    expect(throttle.blocked("a")).toBe(false);
    expect(throttle.blocked("d")).toBe(true);

    vi.advanceTimersByTime(60_001);
    throttle.fail("e");
    expect(throttle.blocked("b")).toBe(false);
    expect(throttle.blocked("e")).toBe(true);
  });
});

describe("caller address", () => {
  const app = new Hono().get("/", (c) => c.text(callerAddress(c)));
  const from = (forwarded: string) =>
    app.request("/", { headers: { "X-Forwarded-For": forwarded } });

  afterEach(() => {
    delete process.env.TACHY_BEHIND_PROXY;
  });

  it("is the forwarded client only where a proxy sets the header", async () => {
    expect(await (await from("10.0.0.1")).text()).toBe("unknown");
    process.env.TACHY_BEHIND_PROXY = "true";
    expect(await (await from("10.0.0.1, 172.18.0.2")).text()).toBe("10.0.0.1");
    expect(await (await app.request("/")).text()).toBe("unknown");
  });
});
