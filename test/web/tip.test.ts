/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GRACE,
  HOVER_DELAY,
  TOUCH_LINGER,
  dismissTip,
  holdTip,
  releaseTip,
  tip,
  tipState,
} from "../../packages/web/src/lib/tui/tip.svelte";

const pointer = (type: string, pointerType = "mouse") =>
  Object.assign(new Event(type), { pointerType });

const control = (label = "settings") => {
  const el = document.createElement("button");
  document.body.append(el);
  return { el, action: tip(el, label) };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  dismissTip();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("a tip on hover", () => {
  it("waits out a sweep before it shows", () => {
    const { el } = control();
    el.dispatchEvent(pointer("pointerenter"));
    vi.advanceTimersByTime(HOVER_DELAY - 1);
    expect(tipState.anchor).toBeNull();
    vi.advanceTimersByTime(1);
    expect(tipState.anchor).toBe(el);
    expect(tipState.text).toBe("settings");
  });

  it("gives the pointer time to reach the tip, and stays while it is there", () => {
    const { el } = control();
    el.dispatchEvent(pointer("pointerenter"));
    vi.advanceTimersByTime(HOVER_DELAY);
    el.dispatchEvent(pointer("pointerleave"));
    holdTip();
    vi.advanceTimersByTime(GRACE * 10);
    expect(tipState.anchor).toBe(el);
    releaseTip();
    vi.advanceTimersByTime(GRACE);
    expect(tipState.anchor).toBeNull();
  });

  it("moves straight to the next control once one is up", () => {
    const a = control("settings");
    const b = control("feedback");
    a.el.dispatchEvent(pointer("pointerenter"));
    vi.advanceTimersByTime(HOVER_DELAY);
    a.el.dispatchEvent(pointer("pointerleave"));
    b.el.dispatchEvent(pointer("pointerenter"));
    expect(tipState.anchor).toBe(b.el);
    expect(tipState.text).toBe("feedback");
  });
});

describe("a tip on touch", () => {
  it("shows on the tap and lingers after the finger lifts", () => {
    const { el } = control();
    el.dispatchEvent(pointer("pointerenter", "touch"));
    el.dispatchEvent(pointer("pointerdown", "touch"));
    expect(tipState.anchor).toBe(el);
    el.dispatchEvent(pointer("pointerup", "touch"));
    vi.advanceTimersByTime(TOUCH_LINGER - 1);
    expect(tipState.anchor).toBe(el);
    vi.advanceTimersByTime(1);
    expect(tipState.anchor).toBeNull();
  });

  it("survives the focus a tap gives the control", () => {
    const { el } = control();
    el.dispatchEvent(pointer("pointerdown", "touch"));
    el.focus();
    el.blur();
    expect(tipState.anchor).toBe(el);
  });
});

describe("a tip on focus", () => {
  it("shows for keyboard focus and goes with it", () => {
    const { el } = control();
    el.matches = (s: string) => s === ":focus-visible";
    el.focus();
    expect(tipState.anchor).toBe(el);
    el.blur();
    expect(tipState.anchor).toBeNull();
  });

  it("stays down for focus a click gives", () => {
    const { el } = control();
    el.matches = () => false;
    el.focus();
    expect(tipState.anchor).toBeNull();
  });
});

describe("the tip's life", () => {
  it("follows a label that changes while it is up", () => {
    const { el, action } = control("delete");
    el.dispatchEvent(pointer("pointerdown", "touch"));
    action.update("click again to confirm");
    expect(tipState.text).toBe("click again to confirm");
    action.update(undefined);
    expect(tipState.anchor).toBeNull();
  });

  it("never shows without a label", () => {
    const el = document.createElement("button");
    tip(el, undefined);
    el.dispatchEvent(pointer("pointerdown", "touch"));
    el.dispatchEvent(pointer("pointerenter"));
    vi.advanceTimersByTime(HOVER_DELAY);
    expect(tipState.anchor).toBeNull();
  });

  it("goes with its control", () => {
    const { el, action } = control();
    el.dispatchEvent(pointer("pointerdown", "touch"));
    action.destroy();
    expect(tipState.anchor).toBeNull();
    el.dispatchEvent(pointer("pointerdown", "touch"));
    expect(tipState.anchor).toBeNull();
  });
});
