import { describe, expect, it } from "vitest";
import {
  CH_EM,
  RAMP_STEPS,
  gutterPx,
  heatFill,
  heatStep,
  labelStride,
  niceDomain,
  stackParts,
  tickCount,
  tickValues,
  toneMix,
  toneVar,
} from "../../packages/web/src/lib/tui/scale";
import type { Part } from "../../packages/web/src/lib/tui/marks";

describe("niceDomain", () => {
  it("starts at zero and ends on a round number", () => {
    expect(niceDomain(87)).toEqual([0, 100]);
    expect(niceDomain(23)).toEqual([0, 25]);
  });

  it("gives an all-zero series something to divide by", () => {
    expect(niceDomain(0)).toEqual([0, 1]);
  });

  it("refuses a domain a mark could not draw in", () => {
    expect(niceDomain(NaN)).toEqual([0, 1]);
    expect(niceDomain(-5)).toEqual([0, 1]);
    expect(niceDomain(Infinity)).toEqual([0, 1]);
  });
});

describe("tickValues", () => {
  it("labels round values across the domain", () => {
    expect(tickValues(0, 100, 4)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("collapses to one label when there is no range", () => {
    expect(tickValues(0, 0)).toEqual([0]);
  });

  /* The overviews count things. An axis of 0, 0.2, 0.4 over a repo tally is
     four labels nobody can read as a number of repos. */
  it("refuses fractional labels on a whole-numbered axis", () => {
    expect(tickValues(0, 1, 4)).toEqual([0, 1]);
    expect(tickValues(0, 2, 4)).toEqual([0, 1, 2]);
    expect(tickValues(0, 3, 4)).toEqual([0, 1, 2, 3]);
  });

  it("keeps them where the series really is fractional", () => {
    expect(tickValues(0, 2.5, 4)).toContain(0.5);
  });
});

describe("tickCount", () => {
  it("keeps labels off each other in a short plot", () => {
    expect(tickCount(40, 12)).toBe(2);
  });

  it("stops before the gridlines read as hatching", () => {
    expect(tickCount(2000, 12)).toBe(5);
  });

  it("scales with the plot in between", () => {
    expect(tickCount(120, 12)).toBe(4);
  });
});

describe("gutterPx", () => {
  it("sizes to the widest label", () => {
    const wide = gutterPx(["1", "1000"], 12);
    const narrow = gutterPx(["1", "10"], 12);
    expect(wide).toBeGreaterThan(narrow);
    expect(wide).toBe(Math.ceil(4 * CH_EM * 12) + 8);
  });

  it("still leaves room for the tick with no labels at all", () => {
    expect(gutterPx([], 12)).toBe(8);
  });
});

describe("labelStride", () => {
  it("draws every label when they all fit", () => {
    expect(labelStride(7, 700, 20)).toBe(1);
  });

  it("thins them when they do not", () => {
    expect(labelStride(14, 140, 20)).toBe(2);
  });

  it("never divides by a zero-width plot", () => {
    expect(labelStride(14, 0, 20)).toBe(1);
    expect(labelStride(0, 100, 20)).toBe(1);
  });
});

describe("stackParts", () => {
  const parts: Part[] = [
    { key: "succeeded", value: 3, tone: "ok" },
    { key: "failed", value: 2, tone: "danger" },
  ];

  it("lays slices end to end from the baseline", () => {
    expect(stackParts(parts)).toEqual([
      { key: "succeeded", tone: "ok", offset: 0, size: 3 },
      { key: "failed", tone: "danger", offset: 3, size: 2 },
    ]);
  });

  it("drops empty slices rather than painting a hairline for them", () => {
    const withZero: Part[] = [
      { key: "a", value: 0, tone: "ok" },
      { key: "b", value: 4, tone: "danger" },
    ];
    expect(stackParts(withZero)).toEqual([
      { key: "b", tone: "danger", offset: 0, size: 4 },
    ]);
  });

  it("has nothing to stack for an unstacked mark", () => {
    expect(stackParts(undefined)).toEqual([]);
    expect(stackParts([])).toEqual([]);
  });
});

describe("tones", () => {
  it("names a series token, so the theme reaches it and the accent does not", () => {
    expect(toneVar("ok")).toBe("var(--series-ok)");
    expect(toneVar()).toBe("var(--series)");
    expect(toneVar("info")).toBe("var(--series-2)");
    expect(toneVar("muted")).toBe("var(--muted)");
  });

  it("thins one token rather than reaching for a second", () => {
    expect(toneMix("danger", 30)).toBe(
      "color-mix(in srgb, var(--series-danger) 30%, transparent)",
    );
  });

  it("clamps a share that came out of a ratio", () => {
    expect(toneMix("ok", 140)).toContain("100%");
    expect(toneMix("ok", -10)).toContain("0%");
  });
});

describe("heat", () => {
  it("puts the busiest day on the last step and a quiet one low", () => {
    expect(heatStep(100, 100)).toBe(RAMP_STEPS.length - 1);
    expect(heatStep(1, 100)).toBe(0);
  });

  it("gives a day with nothing on it no ink at all", () => {
    expect(heatStep(0, 100)).toBe(-1);
    expect(heatFill(0, 100)).toBe("transparent");
  });

  it("does not divide by an empty series", () => {
    expect(heatStep(5, 0)).toBe(-1);
  });

  it("paints through the ramp, never a second hue", () => {
    expect(heatFill(100, 100, "ok")).toBe(toneMix("ok", 100));
    expect(heatFill(1, 100, "ok")).toBe(toneMix("ok", RAMP_STEPS[0]));
  });
});
