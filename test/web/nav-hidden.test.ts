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

import { Flip, gsap } from "../../packages/web/src/motion/gsap";
import { reflow } from "../../packages/web/src/motion/motion";
import {
  loadThemeFromStorage,
  setNavHidden,
  setSubnavHidden,
  themeState,
} from "../../packages/web/src/theme/theme.svelte";

beforeEach(() => {
  localStorage.clear();
  media.reduced = false;
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("the hidden nav bar", () => {
  it("is shown until someone hides it", () => {
    loadThemeFromStorage();
    expect(themeState.navHidden).toBe(false);
  });

  it("survives a reload", () => {
    setNavHidden(true);
    themeState.navHidden = false;
    loadThemeFromStorage();
    expect(themeState.navHidden).toBe(true);

    setNavHidden(false);
    loadThemeFromStorage();
    expect(themeState.navHidden).toBe(false);
  });
});

describe("the hidden subnav", () => {
  it("is remembered on its own, whatever the nav is set to", () => {
    loadThemeFromStorage();
    expect(themeState.subnavHidden).toBe(false);

    setSubnavHidden(true);
    themeState.subnavHidden = false;
    loadThemeFromStorage();
    expect(themeState.subnavHidden).toBe(true);
    expect(themeState.navHidden).toBe(false);

    setSubnavHidden(false);
    loadThemeFromStorage();
    expect(themeState.subnavHidden).toBe(false);
  });
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

  it("fades what the change hides or reveals", () => {
    const el = box();
    const from = vi.spyOn(Flip, "from");
    reflow([el])();
    const vars = from.mock.calls[0][1]!;
    const out = vi.spyOn(gsap, "to");
    (vars.onLeave as (els: Element[]) => void)([el]);
    expect(out).toHaveBeenCalledWith(
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
});
