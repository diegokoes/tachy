export type Theme = "dark" | "light";

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

/* The fluid clamp in tokens.css tops out at 18px and saturates around a
   1571px viewport, so width alone cannot tell a 27" 1440p display from a 32"
   4K one — only pixel density can, and CSS cannot read it. These steps are the
   knob that covers the difference, so the top one has to reach far enough to. */
export const TEXT_SIZES = [
  { key: "small", scale: 0.9 },
  { key: "normal", scale: 1 },
  { key: "large", scale: 1.35 },
] as const;

export type TextSize = (typeof TEXT_SIZES)[number]["key"];

const DEFAULT_SCALE = 1;

export const themeState = $state({
  theme: "dark" as Theme,
  accentColor: ACCENT_DEFAULTS.dark,
  accentCustomized: false,
  fontScale: DEFAULT_SCALE as number,
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
  const changed = themeState.theme !== t;
  themeState.theme = t;
  document.documentElement.dataset.theme = t;
  localStorage.setItem("tachy-theme", t);
  if (!themeState.accentCustomized) applyAccent(ACCENT_DEFAULTS[t]);
  else if (changed) {
    const opposite = OPPOSITE_ACCENTS[themeState.accentColor.toLowerCase()];
    if (opposite) {
      applyAccent(opposite);
      localStorage.setItem("tachy-accent", opposite);
    }
  }
}

export function setFontScale(v: number) {
  const s = TEXT_SIZES.some((t) => t.scale === v) ? v : DEFAULT_SCALE;
  themeState.fontScale = s;
  document.documentElement.style.setProperty("--font-scale", String(s));
  localStorage.setItem("tachy-font-scale", String(s));
}

export function loadThemeFromStorage() {
  const savedTheme = localStorage.getItem("tachy-theme") as Theme | null;
  if (savedTheme === "light" || savedTheme === "dark") {
    themeState.theme = savedTheme;
    document.documentElement.dataset.theme = savedTheme;
  }
  const savedAccent = localStorage.getItem("tachy-accent");
  if (savedAccent) {
    themeState.accentCustomized = true;
    applyAccent(savedAccent);
  } else {
    applyAccent(ACCENT_DEFAULTS[themeState.theme]);
  }

  // The old control was a 0.05-step slider, so a stored value is very unlikely
  // to land on one of the three steps — snap it to the nearest.
  const saved = Number(localStorage.getItem("tachy-font-scale"));
  const nearest =
    Number.isFinite(saved) && saved > 0
      ? TEXT_SIZES.reduce((a, b) =>
          Math.abs(b.scale - saved) < Math.abs(a.scale - saved) ? b : a,
        ).scale
      : DEFAULT_SCALE;
  setFontScale(nearest);
}
