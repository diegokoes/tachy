import { describe, expect, it } from "vitest";
import { createChartGroup } from "../../packages/web/src/tui/chartGroup.svelte";
import {
  areaPath,
  keySpan,
  linePath,
  lineRuns,
  seriesMax,
  seriesPoints,
  visible,
  type Series,
} from "../../packages/web/src/tui/series";
import { tooltipAt, tooltipSize } from "../../packages/web/src/tui/tooltip";
import {
  radarAnchor,
  radarMax,
  radarPath,
  radarPoint,
  radarRing,
  radarTicks,
} from "../../packages/web/src/tui/radar";
import {
  clock,
  hourMarks,
  isSoon,
  nextIndex,
  until,
} from "../../packages/web/src/tui/timeline";
import {
  niceUnit,
  waffleBarCell,
  waffleBarsGrid,
  waffleCell,
  waffleCount,
  waffleGrid,
  waffleShare,
} from "../../packages/web/src/tui/waffle";

describe("waffle", () => {
  it("picks the column count that makes the cells largest", () => {
    const wide = waffleGrid(100, 20, 10, 0);
    expect(waffleGrid(100, 40, 10, 0)).toMatchObject({ cols: 5, size: 20 });
    expect(wide).toMatchObject({ cols: 5, rows: 2, size: 10 });
    const tall = waffleGrid(20, 100, 10, 0);
    expect(tall).toMatchObject({ cols: 1, rows: 10, size: 10 });
  });

  it("fits a box with no room at all without dividing by zero", () => {
    expect(waffleGrid(0, 0, 10).size).toBeLessThanOrEqual(0);
    expect(waffleGrid(50, 50, 0).cols).toBe(1);
  });

  it("counts cells from the bottom left, row by row upward", () => {
    const grid = { cols: 3, rows: 2, size: 10, gap: 2 };
    expect(waffleCell(grid, 0)).toEqual({ x: 0, y: 12 });
    expect(waffleCell(grid, 2)).toEqual({ x: 24, y: 12 });
    expect(waffleCell(grid, 3)).toEqual({ x: 0, y: 0 });
  });

  it("rounds a share to a whole percent", () => {
    expect(waffleShare(96, 120)).toBe(80);
    expect(waffleShare(1, 0)).toBe(0);
  });
});

describe("series", () => {
  const series = (key: string, values: number[]): Series => ({
    key,
    label: key,
    tone: "accent",
    points: values.map((value, i) => ({ key: `d${i}`, value })),
  });

  it("draws a line and closes an area down to its base", () => {
    expect(
      linePath([
        [0, 10],
        [5, 2.5],
      ]),
    ).toBe("M0 10 L5 2.5");
    expect(
      areaPath(
        [
          [0, 10],
          [5, 2],
        ],
        20,
      ),
    ).toBe("M0 10 L5 2 L5 20 L0 20 Z");
    expect(areaPath([], 20)).toBe("");
  });

  it("leaves a hidden series out of the scale", () => {
    const all = [series("a", [1, 9]), series("b", [3, 4])];
    expect(seriesMax(all)).toBe(9);
    expect(seriesMax(visible(all, ["a"]))).toBe(4);
  });

  it("places a series' points through the two scales", () => {
    const pts = seriesPoints(
      series("a", [1, 2]),
      (k) => (k === "d0" ? 0 : 10),
      (v) => 100 - v,
    );
    expect(pts).toEqual([
      [0, 99],
      [10, 98],
    ]);
  });

  it("finds a span of categories whichever way round it is given", () => {
    const keys = ["a", "b", "c", "d"];
    expect(keySpan(keys, "b", "d")).toEqual([1, 3]);
    expect(keySpan(keys, "d", "b")).toEqual([1, 3]);
    expect(keySpan(keys, "b", "zz")).toBeNull();
  });
});

describe("tooltip", () => {
  const lines = [{ label: "value", value: "42" }];

  it("sizes the box to its longest line", () => {
    const small = tooltipSize(undefined, lines, 12);
    const wide = tooltipSize("a much longer heading", lines, 12);
    expect(wide.w).toBeGreaterThan(small.w);
    expect(tooltipSize("t", lines, 12).h).toBeGreaterThan(small.h);
  });

  it("sits right of and above the pointer when there is room", () => {
    const at = tooltipAt(
      { x: 50, y: 80 },
      { w: 40, h: 20 },
      { w: 200, h: 100 },
    );
    expect(at).toEqual({ x: 60, y: 50 });
  });

  it("flips to the left and below at the plot's edges", () => {
    const at = tooltipAt(
      { x: 190, y: 5 },
      { w: 40, h: 20 },
      { w: 200, h: 100 },
    );
    expect(at).toEqual({ x: 140, y: 15 });
  });

  it("stays inside a plot smaller than the box", () => {
    const at = tooltipAt({ x: 10, y: 10 }, { w: 80, h: 60 }, { w: 50, h: 40 });
    expect(at).toEqual({ x: 0, y: 0 });
  });
});

describe("chart group", () => {
  it("switches a series off and on for every chart in it", () => {
    const group = createChartGroup();
    group.toggle("reads");
    group.toggle("writes");
    expect(group.hidden).toEqual(["reads", "writes"]);
    group.toggle("reads");
    expect(group.hidden).toEqual(["writes"]);
  });

  it("follows the pointer, and lets go only for the chart that held it", () => {
    const group = createChartGroup();
    group.point("latency", "2026-10-01");
    expect(group.pointer).toEqual({ source: "latency", key: "2026-10-01" });
    group.leave("errors");
    expect(group.pointer.key).toBe("2026-10-01");
    group.leave("latency");
    expect(group.pointer).toEqual({});
  });
});

describe("waffle bars", () => {
  it("rounds the unit of a cell to 1, 2, 5, 10, 20, 50", () => {
    expect(niceUnit(0.4)).toBe(1);
    expect(niceUnit(1)).toBe(1);
    expect(niceUnit(1.2)).toBe(2);
    expect(niceUnit(3)).toBe(5);
    expect(niceUnit(6)).toBe(10);
    expect(niceUnit(37)).toBe(50);
    expect(niceUnit(512)).toBe(1000);
  });

  it("stacks as many cells in a column as the bar's height holds, and sizes the unit to the longest bar", () => {
    const grid = waffleBarsGrid(400, 200, 4, 800, 2);
    expect(grid.per).toBeGreaterThan(1);
    expect(grid.size).toBeGreaterThanOrEqual(8);
    expect(grid.cols * grid.per * grid.unit).toBeGreaterThanOrEqual(800);
    expect(grid.unit).toBe(niceUnit(grid.unit));
  });

  it("uses one cell per count while the longest bar fits", () => {
    expect(waffleBarsGrid(400, 80, 2, 10, 2).unit).toBe(1);
  });

  it("has no cells in a box with no room", () => {
    expect(waffleBarsGrid(0, 0, 3, 10).cols).toBe(0);
  });

  it("counts at least one cell for anything above zero", () => {
    expect(waffleCount(0, 50)).toBe(0);
    expect(waffleCount(3, 50)).toBe(1);
    expect(waffleCount(120, 50)).toBe(2);
  });

  it("fills a bar down a column and then across", () => {
    const grid = { size: 10, gap: 2, per: 2, cols: 5, unit: 1 };
    expect(waffleBarCell(grid, 0)).toEqual({ x: 0, y: 0 });
    expect(waffleBarCell(grid, 1)).toEqual({ x: 0, y: 12 });
    expect(waffleBarCell(grid, 2)).toEqual({ x: 12, y: 0 });
  });
});

describe("radar", () => {
  it("points the first spoke straight up and goes clockwise", () => {
    const up = radarPoint(0, 4, 10);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(-10);
    const right = radarPoint(1, 4, 10);
    expect(right.x).toBeCloseTo(10);
    expect(right.y).toBeCloseTo(0);
    expect(radarPoint(2, 4, 10).y).toBeCloseTo(10);
  });

  it("outlines one value per spoke against the top of the scale", () => {
    expect(radarPath([10, 0, 5], 10, 20)).toBe("M0 -20 L0 0 L-8.66 5 Z");
    expect(radarPath([], 10, 20)).toBe("");
  });

  it("draws a ring as every spoke at the same distance", () => {
    expect(radarRing(4, 10)).toBe("M0 -10 L10 0 L0 10 L-10 0 Z");
  });

  it("chooses round rings above zero and a top that holds the largest value", () => {
    expect(radarTicks(30, 3)).toEqual([10, 20, 30]);
    expect(radarTicks(0)).toEqual([]);
    expect(radarMax([5, 4, 29, 2])).toBeGreaterThanOrEqual(29);
    expect(radarMax([773, 853, 786])).toBeGreaterThanOrEqual(853);
    expect(radarMax([])).toBe(0);
  });

  it("puts a label on the side of its spoke that points away from the centre", () => {
    expect(radarAnchor(0, 4)).toBe("middle");
    expect(radarAnchor(1, 4)).toBe("start");
    expect(radarAnchor(3, 4)).toBe("end");
  });
});

describe("line runs", () => {
  const at = (p: { key: string; value: number }): [number, number] => [
    Number(p.key),
    p.value,
  ];

  it("keeps a line of one style as one run", () => {
    const runs = lineRuns(
      [
        { key: "0", value: 1 },
        { key: "1", value: 2 },
        { key: "2", value: 3 },
      ],
      at,
    );
    expect(runs).toEqual([
      {
        pts: [
          [0, 1],
          [1, 2],
          [2, 3],
        ],
        dashed: false,
        tone: undefined,
      },
    ]);
  });

  it("cuts the line where a gap was bridged, sharing the point where runs meet", () => {
    const runs = lineRuns(
      [
        { key: "0", value: 1 },
        { key: "1", value: 2, dashed: true },
        { key: "5", value: 3 },
        { key: "6", value: 4 },
      ],
      at,
    );
    expect(runs.map((r) => r.dashed)).toEqual([false, true, false]);
    expect(runs[1].pts).toEqual([
      [1, 2],
      [5, 3],
    ]);
    expect(runs[0].pts.at(-1)).toEqual(runs[1].pts[0]);
  });

  it("changes colour along the line, a segment taking the colour of the point it leaves", () => {
    const runs = lineRuns(
      [
        { key: "0", value: 1, tone: "ok" },
        { key: "1", value: 2, tone: "ok" },
        { key: "2", value: 3, tone: "danger" },
        { key: "3", value: 4 },
      ],
      at,
    );
    expect(runs.map((r) => r.tone)).toEqual(["ok", "danger"]);
    expect(runs[0].pts).toHaveLength(3);
  });

  it("has no runs for fewer than two points", () => {
    expect(lineRuns([], at)).toEqual([]);
    expect(lineRuns([{ key: "0", value: 1 }], at)).toEqual([]);
  });
});

describe("timeline", () => {
  it("says how far off a firing is in the shortest exact words", () => {
    expect(until(20_000)).toBe("now");
    expect(until(12 * 60_000)).toBe("12 min");
    expect(until((3 * 60 + 5) * 60_000)).toBe("3 h 05");
    expect(until(50 * 3_600_000)).toBe("2 d");
  });

  it("finds the first firing that has not happened yet", () => {
    const at = [
      "2026-10-06T10:00:00Z",
      "2026-10-06T11:00:00Z",
      "2026-10-06T12:00:00Z",
    ];
    const now = Date.parse("2026-10-06T10:30:00Z");
    expect(nextIndex(at, now)).toBe(1);
    expect(nextIndex(at, Date.parse("2026-10-07T00:00:00Z"))).toBe(-1);
  });

  it("calls a firing soon when it is within the hour and not past", () => {
    const now = Date.parse("2026-10-06T10:00:00Z");
    expect(isSoon("2026-10-06T10:40:00Z", now)).toBe(true);
    expect(isSoon("2026-10-06T12:00:00Z", now)).toBe(false);
    expect(isSoon("2026-10-06T09:00:00Z", now)).toBe(false);
  });

  it("writes a time the way the viewer's clock does", () => {
    expect(clock(new Date(2026, 9, 6, 7, 5))).toMatch(/^0?7:05$/);
  });
});

describe("hour marks", () => {
  it("falls on the clock's round hours, as a share of the span", () => {
    const from = new Date(2026, 9, 6, 20, 52);
    const marks = hourMarks(from, 24, 6);
    expect(marks.map((m) => m.label.replace(/^0/, ""))).toEqual([
      "0:00",
      "6:00",
      "12:00",
      "18:00",
    ]);
    expect(marks[0].at).toBeCloseTo(((3 * 60 + 8) / (24 * 60)) * 100, 1);
    expect(marks.every((m) => m.at > 0 && m.at < 100)).toBe(true);
  });
});
