/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { ago, span } from "../../packages/web/src/dates.svelte";

const HOUR_MS = 3_600_000;
const now = Date.parse("2026-10-05T12:00:00Z");
const hoursBefore = (hours: number) =>
  new Date(now - hours * HOUR_MS).toISOString();

describe("time spans", () => {
  it("rounds to the largest whole unit", () => {
    expect(span(5 * 60_000)).toBe("5 min");
    expect(span(3 * HOUR_MS)).toBe("3 h");
    expect(span(47 * HOUR_MS)).toBe("47 h");
    expect(span(5 * 24 * HOUR_MS)).toBe("5 d");
  });

  it("never goes below zero", () => {
    expect(span(-HOUR_MS)).toBe("0 min");
  });
});

describe("ago", () => {
  it("says how long ago, in the same units as a span", () => {
    expect(ago(hoursBefore(0.2), now)).toBe("12 min ago");
    expect(ago(hoursBefore(3.25), now)).toBe("3 h ago");
    expect(ago(hoursBefore(24 * 21), now)).toBe("21 d ago");
  });

  it("says never for a time that is missing or unreadable", () => {
    expect(ago(null, now)).toBe("never");
    expect(ago(undefined, now)).toBe("never");
    expect(ago("not a date", now)).toBe("never");
  });
});
