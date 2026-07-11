import { BORDERS, type BorderKey } from "./ascii-patterns";

export type Theme = "dark" | "light";

const ACCENT_DEFAULTS: Record<Theme, string> = {
  dark: "#6ea8fe",
  light: "#31589e",
};

export const themeState = $state({
  theme: "dark" as Theme,
  patternIdx: 0,
  patternAlpha: 0.35,
  accentColor: ACCENT_DEFAULTS.dark,
  accentCustomized: false,
  fontScale: 1,
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
}
