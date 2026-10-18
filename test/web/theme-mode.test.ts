/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no matchMedia; this one answers the two queries the theme reads
// and lets a test flip the OS scheme.
const os = vi.hoisted(() => {
  const os = {
    light: false,
    reduced: false,
    listeners: new Set<() => void>(),
    flip(light: boolean) {
      os.light = light;
      for (const listener of os.listeners) listener();
    },
  };
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes("light") ? os.light : os.reduced;
    },
    addEventListener: (_: string, fn: () => void) => os.listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => os.listeners.delete(fn),
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;
  return os;
});

import { reducedMotion } from "../../packages/web/src/motion/gsap";
import {
  loadTheme,
  resolveMode,
  setMotion,
  setTheme,
  setVision,
  themeState,
} from "../../packages/web/src/theme/theme.svelte";

const root = document.documentElement.dataset;

beforeEach(() => {
  localStorage.clear();
  os.light = false;
  os.reduced = false;
  setTheme("dark");
  setMotion("system");
  setVision("standard");
});

describe("system mode", () => {
  it("paints what the OS asks for", () => {
    os.light = true;
    setTheme("system");
    expect(themeState.mode).toBe("system");
    expect(themeState.theme).toBe("light");
    expect(root.theme).toBe("light");
    expect(resolveMode("system")).toBe("light");
    expect(resolveMode("dark")).toBe("dark");
  });

  it("follows the OS while picked, and stops once a theme is", () => {
    setTheme("system");
    os.flip(true);
    expect(themeState.theme).toBe("light");

    setTheme("dark");
    expect(os.listeners.size).toBe(0);
    os.flip(false);
    os.flip(true);
    expect(themeState.theme).toBe("dark");
  });

  it("survives a reload", () => {
    setTheme("system");
    os.light = true;
    themeState.mode = "dark";
    loadTheme();
    expect(themeState.mode).toBe("system");
    expect(themeState.theme).toBe("light");
  });
});

describe("motion", () => {
  it("reduces on the reader's word as well as the OS's", () => {
    expect(reducedMotion()).toBe(false);
    setMotion("reduced");
    expect(root.motion).toBe("reduced");
    expect(reducedMotion()).toBe(true);

    setMotion("system");
    expect(root.motion).toBeUndefined();
    os.reduced = true;
    expect(reducedMotion()).toBe(true);
  });

  it("survives a reload", () => {
    setMotion("reduced");
    themeState.motion = "system";
    loadTheme();
    expect(themeState.motion).toBe("reduced");
  });
});

describe("color vision", () => {
  it("marks the root for the swapped status colors", () => {
    setVision("red-green");
    expect(root.vision).toBe("red-green");
    setVision("standard");
    expect(root.vision).toBeUndefined();
  });

  it("survives a reload, and ignores a value it does not know", () => {
    setVision("red-green");
    themeState.vision = "standard";
    loadTheme();
    expect(themeState.vision).toBe("red-green");

    localStorage.setItem("tachy-vision", "sepia");
    loadTheme();
    expect(themeState.vision).toBe("standard");
  });
});
