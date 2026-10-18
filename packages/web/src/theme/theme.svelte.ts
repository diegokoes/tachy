import {
  NAV_LABELS,
  TEXT_SIZES,
  THEMES,
  isHexColor,
  type NavLabels,
  type Theme,
} from "@tachy/contract";
import { orgAppearance } from "./org.svelte";

export { NAV_LABELS, TEXT_SIZES, isHexColor };
export type { NavLabels, Theme };

/** A theme, or whichever one the OS asks for. Personal: org defaults name a theme. */
export const THEME_MODES = [...THEMES, "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** Reduced adds to what the OS asks for; it cannot undo an OS reduce. */
export const MOTIONS = ["system", "reduced"] as const;
export type Motion = (typeof MOTIONS)[number];

/** Red-green swaps the status colours for ones that differ in lightness too. */
export const VISIONS = ["standard", "red-green"] as const;
export type Vision = (typeof VISIONS)[number];

const LIGHT_SCHEME = "(prefers-color-scheme: light)";

const ACCENT_DEFAULTS: Record<Theme, string> = {
  dark: "#6ea8fe",
  light: "#31589e",
};

const OPPOSITE_ACCENTS: Record<string, string> = {
  "#000000": "#ffffff",
  "#666666": "#e5e5e5",
  "#e5e5e5": "#666666",
  "#ffffff": "#000000",
};

// The fluid clamp in tokens.css tops out at 18px, so width alone cannot tell a
// 27" 1440p display from a 32" 4K one: only pixel density can, and CSS cannot
// read it. TEXT_SIZES cover the difference.
const DEFAULT_SCALE = 1;

export const themeState = $state({
  mode: "dark" as ThemeMode,
  /** The mode resolved: what is painted. */
  theme: "dark" as Theme,
  accentColor: ACCENT_DEFAULTS.dark,
  /** The far end of the gradient, when the accent is one. */
  accentColor2: null as string | null,
  accentCustomized: false,
  fontScale: DEFAULT_SCALE as number,
  navLabels: "text" as NavLabels,
  motion: "system" as Motion,
  vision: "standard" as Vision,
});

function applyAccent(
  value: string,
  second: string | null = themeState.accentColor2,
) {
  const root = document.documentElement.style;
  themeState.accentColor = value;
  themeState.accentColor2 = second;
  root.setProperty("--accent", value);
  if (second)
    root.setProperty(
      "--accent-fill",
      `linear-gradient(90deg, ${value}, ${second})`,
    );
  else root.removeProperty("--accent-fill");
}

/**
 * The org accent was picked in the org's mode; a grey that vanishes in the
 * other mode swaps for its opposite there.
 */
function applyDefaultAccent() {
  const { accent, accent2, theme } = orgAppearance.value;
  if (!accent) {
    applyAccent(ACCENT_DEFAULTS[themeState.theme], null);
    return;
  }
  const flipped = theme && theme !== themeState.theme;
  const hex = flipped ? (OPPOSITE_ACCENTS[accent] ?? accent) : accent;
  applyAccent(hex, accent2 ?? null);
}

/** A second colour makes the accent a gradient running from the first to it. */
export function selectAccent(hex: string, second: string | null = null) {
  themeState.accentCustomized = true;
  applyAccent(hex, second);
  localStorage.setItem("tachy-accent", hex);
  if (second) localStorage.setItem("tachy-accent-2", second);
  else localStorage.removeItem("tachy-accent-2");
}

export function resetAccent() {
  themeState.accentCustomized = false;
  localStorage.removeItem("tachy-accent");
  localStorage.removeItem("tachy-accent-2");
  applyDefaultAccent();
}

function applyTheme(theme: Theme) {
  themeState.theme = theme;
  document.documentElement.dataset.theme = theme;
}

function systemTheme(): Theme {
  return window.matchMedia(LIGHT_SCHEME).matches ? "light" : "dark";
}

export const resolveMode = (mode: ThemeMode): Theme =>
  mode === "system" ? systemTheme() : mode;

let unfollow: (() => void) | undefined;

/** While the mode is system, the app switches when the OS does. */
function followSystem(mode: ThemeMode) {
  unfollow?.();
  unfollow = undefined;
  if (mode !== "system") return;
  const query = window.matchMedia(LIGHT_SCHEME);
  const onChange = () => switchTheme(systemTheme());
  query.addEventListener("change", onChange);
  unfollow = () => query.removeEventListener("change", onChange);
}

export function setTheme(mode: ThemeMode) {
  themeState.mode = mode;
  localStorage.setItem("tachy-theme", mode);
  followSystem(mode);
  switchTheme(resolveMode(mode));
}

/** Paints `theme` and carries the accent across: a grey that would vanish flips. */
function switchTheme(theme: Theme) {
  const changed = themeState.theme !== theme;
  applyTheme(theme);
  if (!themeState.accentCustomized) applyDefaultAccent();
  else if (changed) {
    const opposite = OPPOSITE_ACCENTS[themeState.accentColor.toLowerCase()];
    if (opposite) {
      applyAccent(opposite);
      localStorage.setItem("tachy-accent", opposite);
    }
  }
}

function applyFontScale(scale: number) {
  themeState.fontScale = scale;
  document.documentElement.style.setProperty("--font-scale", String(scale));
}

export function setFontScale(value: number) {
  const scale = TEXT_SIZES.some((t) => t.scale === value)
    ? value
    : DEFAULT_SCALE;
  applyFontScale(scale);
  localStorage.setItem("tachy-font-scale", String(scale));
}

export function setNavLabels(value: NavLabels) {
  themeState.navLabels = value;
  localStorage.setItem("tachy-nav-labels", value);
}

function applyMotion(motion: Motion) {
  themeState.motion = motion;
  const root = document.documentElement.dataset;
  if (motion === "reduced") root.motion = motion;
  else delete root.motion;
}

export function setMotion(motion: Motion) {
  applyMotion(motion);
  localStorage.setItem("tachy-motion", motion);
}

function applyVision(vision: Vision) {
  themeState.vision = vision;
  const root = document.documentElement.dataset;
  if (vision === "standard") delete root.vision;
  else root.vision = vision;
}

export function setVision(vision: Vision) {
  applyVision(vision);
  localStorage.setItem("tachy-vision", vision);
}

function saved<T extends string>(
  key: string,
  values: readonly T[],
): T | undefined {
  const value = localStorage.getItem(key);
  return values.find((v) => v === value);
}

/** A stored scale may come from a finer-grained control: it snaps to a step. */
function savedFontScale(): number | undefined {
  const saved = Number(localStorage.getItem("tachy-font-scale"));
  if (!Number.isFinite(saved) || saved <= 0) return undefined;
  return TEXT_SIZES.reduce((a, b) =>
    Math.abs(b.scale - saved) < Math.abs(a.scale - saved) ? b : a,
  ).scale;
}

function loadAccent() {
  const saved = localStorage.getItem("tachy-accent");
  themeState.accentCustomized = !!saved;
  if (!saved) {
    applyDefaultAccent();
    return;
  }
  const second = localStorage.getItem("tachy-accent-2");
  applyAccent(saved, second && isHexColor(second) ? second : null);
}

/**
 * Each field is what this browser saved, else the org default, else the
 * built-in. Loading writes nothing, so a later org default still reaches every
 * field the reader never picked.
 */
export function loadTheme() {
  const org = orgAppearance.value;
  const mode = saved("tachy-theme", THEME_MODES) ?? org.theme ?? "dark";
  themeState.mode = mode;
  followSystem(mode);
  applyTheme(resolveMode(mode));
  loadAccent();
  const orgScale = TEXT_SIZES.find((t) => t.key === org.text_size)?.scale;
  applyFontScale(savedFontScale() ?? orgScale ?? DEFAULT_SCALE);
  themeState.navLabels =
    saved("tachy-nav-labels", NAV_LABELS) ?? org.nav_labels ?? "text";
  applyMotion(saved("tachy-motion", MOTIONS) ?? "system");
  applyVision(saved("tachy-vision", VISIONS) ?? "standard");
}
