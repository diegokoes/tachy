import { BORDERS, type BorderKey } from "./ascii-patterns";

export type Theme = "dark" | "light";

const ACCENT_DEFAULTS: Record<Theme, string> = {
  dark: "#6ea8fe",
  light: "#31589e",
};

export type Density = "compact" | "normal" | "roomy";
export type PanelBorder = "single" | "double" | "heavy" | "ascii" | "none";

export const DENSITIES: Density[] = ["compact", "normal", "roomy"];
export const PANEL_BORDERS: PanelBorder[] = [
  "single",
  "double",
  "heavy",
  "ascii",
  "none",
];

/** Corner glyphs per border set, for the Settings preview swatches. */
export const PANEL_BORDER_SAMPLE: Record<PanelBorder, string> = {
  single: "┌─┐",
  double: "╔═╗",
  heavy: "┏━┓",
  ascii: "+-+",
  none: "   ",
};

export const RADIUS_MIN = 0;
export const RADIUS_MAX = 6;

export const themeState = $state({
  theme: "dark" as Theme,
  patternIdx: 0,
  patternAlpha: 0.35,
  accentColor: ACCENT_DEFAULTS.dark,
  accentCustomized: false,
  fontScale: 1,
  radius: 3,
  density: "normal" as Density,
  panelBorder: "single" as PanelBorder,
  border: "none" as BorderKey,
});

function applyAccent(v: string) {
  themeState.accentColor = v;
  document.documentElement.style.setProperty("--accent", v);
}

export function selectAccent(hex: string) {
  themeState.accentCustomized = true;
  applyAccent(hex);
  localStorage.setItem("tachy-accent", hex);
}

export function resetAccent() {
  themeState.accentCustomized = false;
  localStorage.removeItem("tachy-accent");
  applyAccent(ACCENT_DEFAULTS[themeState.theme]);
}

export function setTheme(t: Theme) {
  themeState.theme = t;
  document.documentElement.dataset.theme = t;
  localStorage.setItem("tachy-theme", t);
  if (!themeState.accentCustomized) applyAccent(ACCENT_DEFAULTS[t]);
}

export function setPattern(idx: number) {
  themeState.patternIdx = idx;
  localStorage.setItem("tachy-pattern", String(idx));
}

export function setPatternAlpha(v: number) {
  themeState.patternAlpha = v;
  localStorage.setItem("tachy-pattern-alpha", String(v));
}

export function setFontScale(v: number) {
  themeState.fontScale = v;
  document.documentElement.style.setProperty("--font-scale", String(v));
  localStorage.setItem("tachy-font-scale", String(v));
}

export function setBorder(k: BorderKey) {
  themeState.border = k;
  localStorage.setItem("tachy-border", k);
}

export function setRadius(px: number) {
  const v = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, Math.round(px)));
  themeState.radius = v;
  document.documentElement.style.setProperty("--radius", `${v}px`);
  localStorage.setItem("tachy-radius", String(v));
}

export function setDensity(d: Density) {
  themeState.density = d;
  document.documentElement.dataset.density = d;
  localStorage.setItem("tachy-density", d);
}

export function setPanelBorder(b: PanelBorder) {
  themeState.panelBorder = b;
  document.documentElement.dataset.border = b;
  localStorage.setItem("tachy-panel-border", b);
}

export function loadThemeFromStorage() {
  const savedTheme = localStorage.getItem("tachy-theme") as Theme | null;
  if (savedTheme === "light" || savedTheme === "dark") {
    themeState.theme = savedTheme;
    document.documentElement.dataset.theme = savedTheme;
  }
  const savedPattern = localStorage.getItem("tachy-pattern");
  if (savedPattern !== null) themeState.patternIdx = Number(savedPattern);
  const savedAlpha = localStorage.getItem("tachy-pattern-alpha");
  if (savedAlpha !== null) themeState.patternAlpha = Number(savedAlpha);
  const savedAccent = localStorage.getItem("tachy-accent");
  if (savedAccent) {
    themeState.accentCustomized = true;
    applyAccent(savedAccent);
  } else {
    applyAccent(ACCENT_DEFAULTS[themeState.theme]);
  }
  const savedScale = localStorage.getItem("tachy-font-scale");
  if (savedScale) {
    themeState.fontScale = Number(savedScale);
    document.documentElement.style.setProperty("--font-scale", savedScale);
  }
  const savedBorder = localStorage.getItem("tachy-border");
  if (savedBorder === "none" || (savedBorder && savedBorder in BORDERS))
    themeState.border = savedBorder as BorderKey;

  const savedRadius = localStorage.getItem("tachy-radius");
  setRadius(savedRadius === null ? themeState.radius : Number(savedRadius));

  const savedDensity = localStorage.getItem("tachy-density") as Density | null;
  setDensity(
    savedDensity && DENSITIES.includes(savedDensity)
      ? savedDensity
      : themeState.density,
  );

  const savedPanel = localStorage.getItem(
    "tachy-panel-border",
  ) as PanelBorder | null;
  setPanelBorder(
    savedPanel && PANEL_BORDERS.includes(savedPanel)
      ? savedPanel
      : themeState.panelBorder,
  );
}
