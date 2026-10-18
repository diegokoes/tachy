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
import { confetti } from "../../packages/web/src/motion/motion";

const scroller = () => {
  const el = document.createElement("div");
  el.style.overflow = "auto";
  document.body.append(el);
  return el;
};

afterEach(() => {
  media.reduced = false;
  vi.restoreAllMocks();
  document.body.replaceChildren();
  gsap.globalTimeline.clear();
});

describe("confetti", () => {
  it("flies outside the container, so a scrolling box never grows", () => {
    const box = scroller();
    confetti(box, 5);
    expect(box.children).toHaveLength(0);
    const layer = document.body.lastElementChild as HTMLElement;
    expect(layer).not.toBe(box);
    expect(layer.style.position).toBe("fixed");
    expect(layer.style.pointerEvents).toBe("none");
    expect(layer.children).toHaveLength(5);
  });

  it("takes its layer away with the last piece", () => {
    const to = vi.spyOn(gsap, "to");
    confetti(scroller(), 3);
    const layer = document.body.lastElementChild as HTMLElement;
    const done = to.mock.calls.map(
      (c) => (c[1] as { onComplete: () => void }).onComplete,
    );
    done[0]();
    done[1]();
    expect(layer.isConnected).toBe(true);
    done[2]();
    expect(layer.isConnected).toBe(false);
  });

  it("fires nothing under reduced motion", () => {
    media.reduced = true;
    const box = scroller();
    confetti(box);
    expect(document.body.children).toHaveLength(1);
  });
});
