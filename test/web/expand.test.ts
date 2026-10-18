/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const media = vi.hoisted(() => {
  const media = { reduced: false };
  const noop = () => {};
  window.matchMedia = (() => ({
    get matches() {
      return media.reduced;
    },
    addListener: noop,
    removeListener: noop,
    addEventListener: noop,
    removeEventListener: noop,
  })) as unknown as typeof window.matchMedia;
  return media;
});

import {
  closeTile,
  expandedKey,
  openTile,
  tilePath,
} from "../../packages/web/src/admin/expand.svelte";
import { Flip, gsap } from "../../packages/web/src/motion/gsap";
import {
  breathe,
  focusLane,
  morphTile,
  driftMarks,
} from "../../packages/web/src/motion/motion";
import { navigate, router } from "../../packages/web/src/shell/router.svelte";

const tile = () => {
  const el = document.createElement("section");
  el.className = "tile open";
  document.body.append(el);
  return el;
};

beforeEach(() => {
  media.reduced = false;
  navigate("/console/workers");
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  gsap.globalTimeline.clear();
});

describe("the expanded tile's route", () => {
  it("is named by the third segment under chart", () => {
    navigate("/console/workers/chart/runs");
    expect(expandedKey()).toBe("runs");
    expect(router.path).toBe("/console/workers/chart/runs");
  });

  it("is nothing on the overview or under a section", () => {
    expect(expandedKey()).toBeUndefined();
    navigate("/console/workers/queues/runs");
    expect(expandedKey()).toBeUndefined();
  });

  it("builds the path back to a page's overview without a key", () => {
    expect(tilePath("access", "top-tools")).toBe(
      "/console/access/chart/top-tools",
    );
    expect(tilePath("access")).toBe("/console/access");
  });
});

describe("morphTile", () => {
  it("resizes the live tile from its old box, with no crossfade", async () => {
    const from = vi.spyOn(Flip, "from");
    const el = tile();
    const swap = vi.fn();
    await morphTile(el, swap);
    expect(swap).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledOnce();
    const vars = from.mock.calls[0][1] as Record<string, unknown>;
    expect(vars).toMatchObject({ absolute: true });
    expect(vars.scale).toBeUndefined();
    expect(el.dataset.morphing).toBe("");

    (vars.onComplete as () => void)();
    expect(el.dataset.morphing).toBeUndefined();
  });

  it("changes the layout at once under reduced motion", async () => {
    media.reduced = true;
    const from = vi.spyOn(Flip, "from");
    const el = tile();
    const swap = vi.fn();
    await morphTile(el, swap);
    expect(swap).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
    expect(el.dataset.morphing).toBeUndefined();
  });

  it("still swaps with no tile to move", async () => {
    const swap = vi.fn();
    await morphTile(null, swap);
    expect(swap).toHaveBeenCalledOnce();
  });
});

describe("opening and closing a tile", () => {
  it("goes to the chart's route and back to the overview", async () => {
    await openTile("workers", "runs", tile());
    expect(router.path).toBe("/console/workers/chart/runs");

    await closeTile("workers");
    expect(router.path).toBe("/console/workers");
  });
});

describe("the timeline's motion", () => {
  const els = (n: number) =>
    Array.from({ length: n }, () => document.createElement("span"));

  it("slides each rail's marks one step, forever, and stops when told to", () => {
    const fromTo = vi.spyOn(gsap, "fromTo");
    const stop = driftMarks(els(3), 16);
    expect(fromTo).toHaveBeenCalledTimes(3);
    const to = fromTo.mock.calls[0][2] as { x: number; repeat: number };
    expect(to).toMatchObject({ x: -16, repeat: -1 });
    expect(() => stop()).not.toThrow();
  });

  it("breathes the ticks it is given and puts them back when stopped", () => {
    const to = vi.spyOn(gsap, "to");
    const ticks = els(2);
    const stop = breathe(ticks);
    expect(to).toHaveBeenCalledTimes(2);
    stop();
    expect(ticks[0].style.opacity).toBe("");
  });

  it("brings one lane forward and steps the others back", () => {
    const to = vi.spyOn(gsap, "to");
    const lanes = els(3);
    focusLane(lanes, lanes[1], () => []);
    expect(to).toHaveBeenCalledTimes(6);
    const opacities = to.mock.calls
      .map((c) => (c[1] as { opacity?: number }).opacity)
      .filter((o) => o !== undefined);
    expect(opacities).toEqual([0.4, 1, 0.4]);
  });

  it("does nothing under reduced motion", () => {
    media.reduced = true;
    const fromTo = vi.spyOn(gsap, "fromTo");
    const to = vi.spyOn(gsap, "to");
    driftMarks(els(2), 16);
    breathe(els(2));
    focusLane(els(2), null, () => []);
    expect(fromTo).not.toHaveBeenCalled();
    expect(to).not.toHaveBeenCalled();
  });

  it("has nothing to move when there are no lanes", () => {
    const fromTo = vi.spyOn(gsap, "fromTo");
    driftMarks([], 16);
    expect(fromTo).not.toHaveBeenCalled();
  });
});
