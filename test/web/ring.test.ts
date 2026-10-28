/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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
import { ring } from "../../packages/web/src/motion/motion";

const bell = () => {
  const el = document.createElement("span");
  document.body.append(el);
  return el;
};

afterEach(() => {
  media.reduced = false;
  document.body.replaceChildren();
  gsap.globalTimeline.clear();
});

describe("ring", () => {
  it("swings both ways and comes to rest upright", () => {
    const el = bell();
    const swing = ring(el);
    expect(swing).not.toBeNull();
    expect(el.style.transformOrigin).toBe("50% 12%");
    const angles = [0.1, 0.25, 0.4].map((progress) => {
      swing!.progress(progress);
      return Number(gsap.getProperty(el, "rotation"));
    });
    expect(Math.max(...angles)).toBeGreaterThan(0);
    expect(Math.min(...angles)).toBeLessThan(0);
    swing!.progress(1);
    expect(el.style.transform).toBe("");
    expect(el.style.transformOrigin).toBe("");
  });

  it("stays still under reduced motion", () => {
    media.reduced = true;
    const el = bell();
    expect(ring(el)).toBeNull();
    expect(el.style.transform).toBe("");
  });
});
