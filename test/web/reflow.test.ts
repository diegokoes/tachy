/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ScrollTrigger reads matchMedia as the gsap module registers it, which jsdom
// does not have.
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

import { Flip, gsap } from "../../packages/web/src/motion/gsap";
import { reflow } from "../../packages/web/src/motion/motion";

beforeEach(() => {
  media.reduced = false;
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("reflow", () => {
  const box = () => {
    const el = document.createElement("div");
    document.body.append(el);
    return el;
  };

  it("tweens from the boxes it recorded, once the layout has changed", () => {
    const el = box();
    const from = vi.spyOn(Flip, "from");
    const play = reflow([el, null, undefined], { duration: 0.2 });
    expect(from).not.toHaveBeenCalled();
    play();
    expect(from).toHaveBeenCalledOnce();
    const [state, vars] = from.mock.calls[0];
    expect((state as { targets: Element[] }).targets).toEqual([el]);
    expect(vars).toMatchObject({ duration: 0.2, absolute: true });
  });

  it("keeps the nodes in flow when asked to", () => {
    const from = vi.spyOn(Flip, "from");
    reflow([box()], { absolute: false })();
    expect(from.mock.calls[0][1]).toMatchObject({ absolute: false });
  });

  it("fades what the change hides or reveals", () => {
    const el = box();
    const from = vi.spyOn(Flip, "from");
    reflow([el])();
    const vars = from.mock.calls[0][1]!;
    const gsapTo = vi.spyOn(gsap, "to");
    (vars.onLeave as (els: Element[]) => void)([el]);
    expect(gsapTo).toHaveBeenCalledWith(
      [el],
      expect.objectContaining({ opacity: 0 }),
    );
    (vars.onEnter as (els: Element[]) => void)([el]);
    expect(el.style.opacity).toBe("0");
  });

  it("leaves the layout to snap under reduced motion", () => {
    media.reduced = true;
    const state = vi.spyOn(Flip, "getState");
    const from = vi.spyOn(Flip, "from");
    reflow([box()])();
    expect(state).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("has nothing to do before the nodes exist", () => {
    const from = vi.spyOn(Flip, "from");
    reflow([undefined, null])();
    expect(from).not.toHaveBeenCalled();
  });

  it("says when the nodes have landed", () => {
    const from = vi.spyOn(Flip, "from");
    const landed = vi.fn();
    reflow([box()], { onComplete: landed })();
    expect(landed).not.toHaveBeenCalled();
    expect(from.mock.calls[0][1]).toMatchObject({ onComplete: landed });
  });

  // A caller waiting on the landing must not wait for a tween that never runs.
  it("says so at once when nothing travels", () => {
    const landed = vi.fn();
    const play = reflow([undefined], { onComplete: landed });
    expect(landed).not.toHaveBeenCalled();
    play();
    expect(landed).toHaveBeenCalledOnce();

    media.reduced = true;
    reflow([box()], { onComplete: landed })();
    expect(landed).toHaveBeenCalledTimes(2);
  });
});
