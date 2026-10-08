/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import {
  ageHours,
  ago,
  col,
  seriesStats,
  signed,
} from "../../packages/web/src/admin/detail";
import {
  followPeriod,
  period,
  periodQuery,
  setPeriod,
} from "../../packages/web/src/admin/period.svelte";
import {
  band,
  freshnessBands,
  freshnessGroups,
  freshnessState,
} from "../../packages/web/src/sources/freshness";

const at = (hours: number, now: number) =>
  new Date(now - hours * 3_600_000).toISOString();

describe("seriesStats", () => {
  const rows = (...v: number[]) =>
    v.map((value, i) => ({ label: `d${i}`, value }));

  it("totals a series, averages it over every day and names the peak", () => {
    const stats = seriesStats(rows(2, 0, 10, 4));
    expect(stats.total).toBe(16);
    expect(stats.mean).toBe(4);
    expect(stats.peak).toEqual({ label: "d2", value: 10 });
  });

  it("compares the later half of the series with the earlier", () => {
    expect(seriesStats(rows(10, 10, 15, 15)).change).toBeCloseTo(0.5);
    expect(seriesStats(rows(20, 20, 10, 10)).change).toBeCloseTo(-0.5);
  });

  it("has nothing to compare against when the earlier half is empty or the series is short", () => {
    expect(seriesStats(rows(0, 0, 5, 5)).change).toBeNull();
    expect(seriesStats(rows(5)).change).toBeNull();
  });

  it("has no peak in a series of zeroes or of nothing", () => {
    expect(seriesStats(rows(0, 0)).peak).toBeNull();
    expect(seriesStats([])).toEqual({
      total: 0,
      mean: 0,
      peak: null,
      change: null,
    });
  });
});

describe("signed", () => {
  it("prints a change with its sign, or a dash when there is none", () => {
    expect(signed(0.123)).toBe("+12%");
    expect(signed(-0.08)).toBe("-8%");
    expect(signed(0)).toBe("0%");
    expect(signed(null)).toBe("–");
  });
});

describe("ago and ageHours", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");

  it("says how stale a timestamp is in the unit a person reads it in", () => {
    expect(ago(at(0.2, now), now)).toBe("12 min ago");
    expect(ago(at(3.25, now), now)).toBe("3.3 h ago");
    expect(ago(at(30, now), now)).toBe("30 h ago");
    expect(ago(at(24 * 12, now), now)).toBe("12 d ago");
  });

  it("calls something that never ran never, and measures nothing for it", () => {
    expect(ago(null, now)).toBe("never");
    expect(ageHours(null, now)).toBeNull();
    expect(ageHours(at(6, now), now)).toBeCloseTo(6);
  });

  it("does not report a timestamp from the future as negative", () => {
    expect(ageHours(at(-5, now), now)).toBe(0);
  });
});

describe("col", () => {
  it("builds a plain value column", () => {
    const column = col<{ n: number }>("n", "count", (r) => r.n, { end: true });
    expect(column).toMatchObject({ key: "n", label: "count", align: "end" });
    expect(column.value?.({ n: 3 })).toBe(3);
  });
});

describe("freshness bands", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const tracked = (
    kind: "source" | "repo" | "bucket",
    key: string,
    h: number | null,
  ) => ({
    kind,
    key,
    label: key,
    last_at: h === null ? null : at(h, now),
    error: null,
  });

  it("puts a timestamp in the band it is younger than", () => {
    expect(band(at(0.5, now), now)).toBe("hour");
    expect(band(at(5, now), now)).toBe("six");
    expect(band(at(20, now), now)).toBe("day");
    expect(band(at(60, now), now)).toBe("three");
    expect(band(at(100, now), now)).toBe("week");
    expect(band(at(500, now), now)).toBe("older");
    expect(band(null, now)).toBe("never");
  });

  it("counts everything into bands, split by what kind of thing it is", () => {
    const bands = freshnessBands(
      [
        tracked("source", "a", null),
        tracked("repo", "b", 1.5),
        tracked("repo", "c", 2),
        tracked("bucket", "d", 500),
      ],
      now,
    );
    const by = Object.fromEntries(bands.map((b) => [b.key, b]));
    expect(by.never.value).toBe(1);
    expect(by.six.value).toBe(2);
    expect(by.six.parts.find((p) => p.key === "repo")?.value).toBe(2);
    expect(by.older.value).toBe(1);
    expect(bands.reduce((n, b) => n + b.value, 0)).toBe(4);
  });
});

describe("the period of a detail view", () => {
  it("asks the routes for its window and tells the resources that follow it", () => {
    const reload = vi.fn();
    const stop = followPeriod(reload);
    expect(periodQuery()).toBe("");

    setPeriod(90);
    expect(period.days).toBe(90);
    expect(periodQuery()).toBe("?days=90");
    expect(reload).toHaveBeenCalledTimes(1);

    setPeriod(90);
    expect(reload).toHaveBeenCalledTimes(1);

    setPeriod(undefined);
    expect(periodQuery()).toBe("");
    expect(reload).toHaveBeenCalledTimes(2);

    stop();
    setPeriod(7);
    expect(reload).toHaveBeenCalledTimes(2);
    setPeriod(undefined);
  });
});

describe("freshness states", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const row = (
    kind: "source" | "repo" | "bucket",
    key: string,
    h: number | null,
  ) => ({
    kind,
    key,
    label: key,
    last_at: h === null ? null : at(h, now),
    error: null,
  });

  it("reads a band as fine, ageing, neglected or never", () => {
    expect(freshnessState(at(3, now), now)).toBe("fresh");
    expect(freshnessState(at(60, now), now)).toBe("week");
    expect(freshnessState(at(500, now), now)).toBe("older");
    expect(freshnessState(null, now)).toBe("never");
  });

  it("makes a cell of every thing, grouped by kind, with a colour for its state", () => {
    const groups = freshnessGroups(
      [row("repo", "a", 2), row("repo", "b", null), row("source", "c", 500)],
      now,
    );
    const by = Object.fromEntries(groups.map((g) => [g.key, g]));
    expect(by.repo.items.map((i) => i.tone)).toEqual(["ok", "danger"]);
    expect(by.source.items.map((i) => i.tone)).toEqual(["warn"]);
    expect(by.bucket.items).toEqual([]);
  });
});
