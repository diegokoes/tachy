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
import { gsap } from "../../packages/web/src/motion/gsap";
import {
  breathe,
  focusLane,
  morphTile,
  driftMarks,
} from "../../packages/web/src/motion/motion";
import { navigate, router } from "../../packages/web/src/shell/router.svelte";
import { deferred } from "./deferred";

const root = document.documentElement;
const doc = document as { startViewTransition?: unknown };

function fakeTransition() {
  const phases = {
    updated: Promise.resolve() as Promise<unknown>,
    ready: deferred(),
    finished: deferred(),
  };
  doc.startViewTransition = vi.fn((update: () => Promise<void>) => {
    phases.updated = update();
    return { ready: phases.ready.promise, finished: phases.finished.promise };
  });
  return phases;
}

const tile = () => {
  const el = document.createElement("section");
  el.className = "tile open";
  document.body.append(el);
  return el;
};

beforeEach(() => {
  media.reduced = false;
  navigate("/admin/workers");
});
afterEach(() => {
  delete doc.startViewTransition;
  delete root.dataset.tileMorph;
  document.body.replaceChildren();
  gsap.globalTimeline.clear();
});

describe("the expanded tile's route", () => {
  it("is named by the third segment under chart", () => {
    navigate("/admin/workers/chart/runs");
    expect(expandedKey()).toBe("runs");
    expect(router.path).toBe("/admin/workers/chart/runs");
  });

  it("is nothing on the overview or under a section", () => {
    expect(expandedKey()).toBeUndefined();
    navigate("/admin/workers/queues/runs");
    expect(expandedKey()).toBeUndefined();
  });

  it("builds the path back to a page's overview without a key", () => {
    expect(tilePath("access", "top-tools")).toBe(
      "/admin/access/chart/top-tools",
    );
    expect(tilePath("access")).toBe("/admin/access");
  });
});

describe("morphTile", () => {
  it("changes the layout at once where there are no view transitions", () => {
    const swap = vi.fn();
    morphTile(tile(), swap);
    expect(swap).toHaveBeenCalledOnce();
  });

  it("changes it at once under reduced motion", () => {
    fakeTransition();
    media.reduced = true;
    const swap = vi.fn();
    morphTile(tile(), swap);
    expect(swap).toHaveBeenCalledOnce();
    expect(doc.startViewTransition).not.toHaveBeenCalled();
  });

  it("names the tile for the length of the transition only", async () => {
    const phases = fakeTransition();
    const el = tile();
    const swap = vi.fn();
    morphTile(el, swap);
    expect(el.style.viewTransitionName).toBe("tile");
    expect(root.dataset.tileMorph).toBeDefined();
    await phases.updated;
    expect(swap).toHaveBeenCalledOnce();

    phases.finished.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(el.style.viewTransitionName).toBe("");
    expect(root.dataset.tileMorph).toBeUndefined();
  });

  it("clears the name when the transition is skipped", async () => {
    const phases = fakeTransition();
    const el = tile();
    morphTile(el, () => {});
    phases.ready.reject(new Error("skipped"));
    phases.finished.reject(new Error("skipped"));
    await new Promise((r) => setTimeout(r, 0));
    expect(el.style.viewTransitionName).toBe("");
  });
});

describe("opening and closing a tile", () => {
  it("goes to the chart's route and back to the overview", async () => {
    const phases = fakeTransition();
    openTile("workers", "runs", tile());
    await phases.updated;
    expect(router.path).toBe("/admin/workers/chart/runs");

    const back = fakeTransition();
    closeTile("workers");
    await back.updated;
    expect(router.path).toBe("/admin/workers");
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
