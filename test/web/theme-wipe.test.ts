/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ScrollTrigger reads matchMedia as the gsap module registers it, which jsdom
   does not have. */
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

import { gsap } from "../../packages/web/src/motion/gsap";
import { themeWipe } from "../../packages/web/src/motion/motion";

const root = document.documentElement;
const doc = document as { startViewTransition?: unknown };

/** A view transition whose phases the test settles by hand. */
function fakeTransition() {
  const phases = {
    updated: Promise.resolve() as Promise<unknown>,
    ready: Promise.withResolvers<void>(),
    finished: Promise.withResolvers<void>(),
  };
  doc.startViewTransition = vi.fn((update: () => Promise<void>) => {
    phases.updated = update();
    return { ready: phases.ready.promise, finished: phases.finished.promise };
  });
  return phases;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  media.reduced = false;
  root.animate = vi.fn() as unknown as typeof root.animate;
});
afterEach(() => {
  delete doc.startViewTransition;
  delete root.dataset.themeWipe;
  root.style.removeProperty("--theme-wipe");
  document.body.replaceChildren();
  gsap.globalTimeline.clear();
});

describe("themeWipe", () => {
  it("swaps at once where there are no view transitions", () => {
    const swap = vi.fn();
    themeWipe(swap);
    expect(swap).toHaveBeenCalledOnce();
    expect(root.dataset.themeWipe).toBeUndefined();
  });

  it("swaps at once under reduced motion", () => {
    fakeTransition();
    media.reduced = true;
    const swap = vi.fn();
    themeWipe(swap);
    expect(swap).toHaveBeenCalledOnce();
    expect(doc.startViewTransition).not.toHaveBeenCalled();
  });

  it("swaps inside the transition and mounts the bands after it", async () => {
    const phases = fakeTransition();
    const swap = vi.fn(() => {
      expect(document.querySelector(".theme-wipe")).toBeNull();
    });
    themeWipe(swap, "bottom");
    await phases.updated;
    expect(swap).toHaveBeenCalledOnce();
    expect(document.querySelectorAll(".theme-wipe path")).toHaveLength(2);
    expect(root.dataset.themeWipe).toBe("");
  });

  it("starts with nothing uncovered and ends with everything", async () => {
    const phases = fakeTransition();
    const h = window.innerHeight;
    themeWipe(() => {}, "bottom");
    const clip = () => root.style.getPropertyValue("--theme-wipe");
    const ys = () =>
      [...clip().matchAll(/C \S+ \S+ \S+ \S+ \S+ (\S+)/g)].map((m) => +m[1]);
    expect(ys()).toHaveLength(9);
    expect(ys().every((y) => y === h)).toBe(true);

    phases.ready.resolve();
    await settle();
    expect(root.animate).toHaveBeenCalledWith(
      { opacity: [1, 1] },
      expect.objectContaining({ pseudoElement: "::view-transition-old(root)" }),
    );
    const tl = gsap.globalTimeline.getChildren(false)[0];
    tl.progress(1);
    expect(ys().every((y) => y === 0)).toBe(true);
    expect(clip()).toContain(`V ${h} H 0 Z`);
  });

  it("comes down from the top when asked to", async () => {
    const phases = fakeTransition();
    themeWipe(() => {}, "top");
    expect(root.style.getPropertyValue("--theme-wipe")).toContain("V 0 H 0 Z");
    phases.ready.resolve();
    await settle();
    gsap.globalTimeline.getChildren(false)[0].progress(1);
    const band = document.querySelector(".theme-wipe path")!.getAttribute("d")!;
    expect(band.startsWith(`M 0 ${window.innerHeight} C`)).toBe(true);
  });

  it("cleans up when the transition finishes", async () => {
    const phases = fakeTransition();
    themeWipe(() => {});
    await phases.updated;
    phases.finished.resolve();
    await settle();
    expect(document.querySelector(".theme-wipe")).toBeNull();
    expect(root.dataset.themeWipe).toBeUndefined();
    expect(root.style.getPropertyValue("--theme-wipe")).toBe("");
  });

  it("cleans up when the transition never becomes ready", async () => {
    const phases = fakeTransition();
    themeWipe(() => {});
    await phases.updated;
    phases.ready.reject(new Error("skipped"));
    phases.finished.resolve();
    await settle();
    expect(document.querySelector(".theme-wipe")).toBeNull();
    expect(root.dataset.themeWipe).toBeUndefined();
  });

  it("leaves the root to a wipe that started while it was running", async () => {
    const first = fakeTransition();
    themeWipe(() => {});
    await first.updated;
    const second = fakeTransition();
    themeWipe(() => {});
    await second.updated;
    first.finished.resolve();
    await settle();
    expect(document.querySelectorAll(".theme-wipe")).toHaveLength(1);
    expect(root.dataset.themeWipe).toBe("");
    expect(root.style.getPropertyValue("--theme-wipe")).not.toBe("");
  });
});
