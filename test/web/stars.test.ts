/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

// ScrollTrigger reads matchMedia as the gsap module registers it, which jsdom
// does not have.
vi.hoisted(() => {
  const noop = () => {};
  window.matchMedia = (() => ({
    matches: false,
    addListener: noop,
    removeListener: noop,
    addEventListener: noop,
    removeEventListener: noop,
  })) as unknown as typeof window.matchMedia;
});

import { gsap } from "../../packages/web/src/motion/gsap";
import { scatter, twinkle } from "../../packages/web/src/motion/stars";

describe("scatter", () => {
  it("places the stars it is asked for inside the layer", () => {
    const stars = scatter(50);
    expect(stars).toHaveLength(50);
    for (const star of stars) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThanOrEqual(100);
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThanOrEqual(100);
      expect(star.dim).toBeGreaterThanOrEqual(0.6);
      expect(["·", "*", "+", "'"]).toContain(star.glyph);
    }
  });
});

describe("twinkle", () => {
  it("breathes a star below its resting light and back, forever", () => {
    const [star] = scatter(1);
    const el = document.createElement("span");
    const calm = twinkle(el, star);
    expect(calm.repeat()).toBe(-1);
    expect(calm.yoyo()).toBe(true);
    expect(calm.duration()).toBeGreaterThanOrEqual(3);

    const intense = twinkle(el, star, true);
    expect(intense.duration()).toBeLessThanOrEqual(3);
    gsap.killTweensOf(el);
  });
});
