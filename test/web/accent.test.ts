/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  isHexColor,
  loadThemeFromStorage,
  resetAccent,
  selectAccent,
  setTheme,
  themeState,
} from "../../packages/web/src/theme/theme.svelte";

const root = document.documentElement.style;

beforeEach(() => {
  localStorage.clear();
  resetAccent();
});

describe("isHexColor", () => {
  it("takes #rrggbb and nothing else", () => {
    expect(isHexColor("#A1b2C3")).toBe(true);
    expect(isHexColor("#abc")).toBe(false);
    expect(isHexColor("a1b2c3")).toBe(false);
    expect(isHexColor("#a1b2c3ff")).toBe(false);
  });
});

describe("accent", () => {
  it("stores a custom colour and paints fills with it", () => {
    selectAccent("#123456");
    expect(themeState.accentColor).toBe("#123456");
    expect(themeState.accentColor2).toBeNull();
    expect(root.getPropertyValue("--accent")).toBe("#123456");
    expect(root.getPropertyValue("--accent-fill")).toBe("");
    expect(localStorage.getItem("tachy-accent")).toBe("#123456");
    expect(localStorage.getItem("tachy-accent-2")).toBeNull();
  });

  it("paints fills with the gradient when given a second colour", () => {
    selectAccent("#123456", "#abcdef");
    expect(themeState.accentColor2).toBe("#abcdef");
    expect(root.getPropertyValue("--accent")).toBe("#123456");
    expect(root.getPropertyValue("--accent-fill")).toBe(
      "linear-gradient(90deg, #123456, #abcdef)",
    );
    expect(localStorage.getItem("tachy-accent-2")).toBe("#abcdef");
  });

  it("drops the gradient when a single colour is picked after it", () => {
    selectAccent("#123456", "#abcdef");
    selectAccent("#cd3131");
    expect(themeState.accentColor2).toBeNull();
    expect(root.getPropertyValue("--accent-fill")).toBe("");
    expect(localStorage.getItem("tachy-accent-2")).toBeNull();
  });

  it("keeps the gradient across a theme change", () => {
    selectAccent("#123456", "#abcdef");
    setTheme(themeState.theme === "dark" ? "light" : "dark");
    expect(themeState.accentColor2).toBe("#abcdef");
    expect(root.getPropertyValue("--accent-fill")).toContain("#abcdef");
    setTheme("dark");
  });

  it("reset clears both colours", () => {
    selectAccent("#123456", "#abcdef");
    resetAccent();
    expect(themeState.accentCustomized).toBe(false);
    expect(themeState.accentColor2).toBeNull();
    expect(root.getPropertyValue("--accent-fill")).toBe("");
    expect(localStorage.getItem("tachy-accent")).toBeNull();
    expect(localStorage.getItem("tachy-accent-2")).toBeNull();
  });

  it("restores a stored gradient, and ignores a second colour that is not one", () => {
    localStorage.setItem("tachy-accent", "#123456");
    localStorage.setItem("tachy-accent-2", "#abcdef");
    loadThemeFromStorage();
    expect(themeState.accentColor2).toBe("#abcdef");
    expect(root.getPropertyValue("--accent-fill")).toContain("#abcdef");

    localStorage.setItem("tachy-accent-2", "red; --x: 1");
    loadThemeFromStorage();
    expect(themeState.accentColor2).toBeNull();
    expect(root.getPropertyValue("--accent-fill")).toBe("");
  });
});
