/**
 * Three semantic faces, each pickable from Settings › ui.
 *
 * Every stack ends in DejaVu Mono before its generic - see the note in
 * tokens.css. It is the only bundled face carrying the block, box-drawing and
 * geometric glyphs the TUI chrome is built from, so a user-picked primary can
 * never take those away.
 */

import { FONT_KEYS, type FontAxis, type FontKey } from "@tachy/contract";
import { orgAppearance } from "./org.svelte";

export type { FontAxis };

type Family<A extends FontAxis = FontAxis> = {
  key: FontKey<A>;
  label: string;
  /** The primary face(s), before the shared tail. */
  stack: string;
  /** @fontsource entry point, loaded on demand. Absent = already on the machine. */
  load?: () => Promise<unknown>;
};

const TAIL = {
  ui: '"DejaVu Mono", sans-serif',
  prose: '"DejaVu Mono", serif',
  mono: 'ui-monospace, "DejaVu Mono", monospace',
} as const;

const PLEX_SANS: Family<"ui"> & Family<"prose"> = {
  key: "plex-sans",
  label: "IBM Plex Sans",
  stack: '"IBM Plex Sans Variable", "IBM Plex Sans"',
};

export const FAMILIES: { [A in FontAxis]: Family<A>[] } = {
  ui: [
    PLEX_SANS,
    {
      key: "inter",
      label: "Inter",
      stack: '"Inter Variable", Inter',
      load: () => import("@fontsource-variable/inter"),
    },
    {
      key: "source-sans",
      label: "Source Sans 3",
      stack: '"Source Sans 3 Variable", "Source Sans 3"',
      load: () => import("@fontsource-variable/source-sans-3"),
    },
    {
      key: "atkinson",
      label: "Atkinson Hyperlegible",
      stack: '"Atkinson Hyperlegible"',
      load: () => import("@fontsource/atkinson-hyperlegible/400.css"),
    },
    {
      key: "system",
      label: "System UI",
      stack: 'system-ui, "Segoe UI", -apple-system, ui-sans-serif',
    },
  ],
  prose: [
    // Reading defaults to whatever the interface face is, so the app reads as
    // one thing until someone splits it.
    { key: "match", label: "Match interface", stack: "var(--font-ui)" },
    {
      key: "source-serif",
      label: "Source Serif 4",
      stack: '"Source Serif 4 Variable", "Source Serif 4"',
      load: () => import("@fontsource-variable/source-serif-4"),
    },
    {
      key: "literata",
      label: "Literata",
      stack: '"Literata Variable", Literata',
      load: () => import("@fontsource-variable/literata"),
    },
    PLEX_SANS,
  ],
  mono: [
    { key: "plex-mono", label: "IBM Plex Mono", stack: '"IBM Plex Mono"' },
    {
      key: "jetbrains",
      label: "JetBrains Mono",
      stack: '"JetBrains Mono"',
      load: () => import("@fontsource/jetbrains-mono/400.css"),
    },
    {
      key: "cascadia",
      label: "Cascadia Mono",
      stack: '"Cascadia Mono"',
      load: () => import("@fontsource/cascadia-mono/400.css"),
    },
  ],
};

const DEFAULTS: { [A in FontAxis]: FontKey<A> } = {
  ui: "plex-sans",
  prose: "match",
  mono: "plex-mono",
};

const AXES = Object.keys(FONT_KEYS) as FontAxis[];

export const fontState = $state<Record<FontAxis, string>>({ ...DEFAULTS });

const storageKey = (axis: FontAxis) => `tachy-font-${axis}`;

function family(axis: FontAxis, key: string): Family {
  const families: Family[] = FAMILIES[axis];
  return (
    families.find((f) => f.key === key) ??
    families.find((f) => f.key === DEFAULTS[axis])!
  );
}

/** The built-in face is the one tokens.css names, so it needs no override. */
function applyFont(axis: FontAxis, key: string) {
  const fam = family(axis, key);
  fontState[axis] = fam.key;
  const root = document.documentElement.style;
  if (fam.key === DEFAULTS[axis]) {
    root.removeProperty(`--font-${axis}`);
    return;
  }
  // "match" resolves to var(--font-ui), which already carries its own tail.
  const value = fam.stack.startsWith("var(")
    ? fam.stack
    : `${fam.stack}, ${TAIL[axis]}`;
  // Swap the stack first: font-display is swap, so the face arrives without a
  // blank frame and the picker feels immediate either way.
  root.setProperty(`--font-${axis}`, value);
  fam.load?.();
}

export function setFont(axis: FontAxis, key: string) {
  applyFont(axis, key);
  localStorage.setItem(storageKey(axis), fontState[axis]);
}

/** What this browser saved, else the org default, else the built-in. */
export function loadFonts() {
  for (const axis of AXES) {
    const saved = localStorage.getItem(storageKey(axis));
    const org = orgAppearance.value[`font_${axis}`];
    applyFont(axis, saved ?? org ?? DEFAULTS[axis]);
  }
}
