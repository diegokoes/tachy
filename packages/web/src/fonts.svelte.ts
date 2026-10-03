/**
 * Three semantic faces, each pickable from Settings › ui.
 *
 * Every stack ends in DejaVu Mono before its generic — see the note in
 * tokens.css. It is the only bundled face carrying the block, box-drawing and
 * geometric glyphs the TUI chrome is built from, so a user-picked primary can
 * never take those away.
 */

export type FontAxis = "ui" | "prose" | "mono";

type Family = {
  key: string;
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

const PLEX_SANS: Family = {
  key: "plex-sans",
  label: "IBM Plex Sans",
  stack: '"IBM Plex Sans Variable", "IBM Plex Sans"',
};

export const FAMILIES: Record<FontAxis, Family[]> = {
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
    // one thing until someone deliberately splits it.
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

const DEFAULTS: Record<FontAxis, string> = {
  ui: "plex-sans",
  prose: "match",
  mono: "plex-mono",
};

export const fontState = $state({ ...DEFAULTS });

const storageKey = (axis: FontAxis) => `tachy-font-${axis}`;

function family(axis: FontAxis, key: string): Family {
  return (
    FAMILIES[axis].find((f) => f.key === key) ??
    FAMILIES[axis].find((f) => f.key === DEFAULTS[axis])!
  );
}

function apply(axis: FontAxis, fam: Family) {
  // "match" resolves to var(--font-ui), which already carries its own tail.
  const value = fam.stack.startsWith("var(")
    ? fam.stack
    : `${fam.stack}, ${TAIL[axis]}`;
  document.documentElement.style.setProperty(`--font-${axis}`, value);
}

export function setFont(axis: FontAxis, key: string) {
  const fam = family(axis, key);
  fontState[axis] = fam.key;
  localStorage.setItem(storageKey(axis), fam.key);
  // Swap the stack first: font-display is swap, so the face arrives without a
  // blank frame and the picker feels immediate either way.
  apply(axis, fam);
  fam.load?.();
}

export function loadFonts() {
  for (const axis of ["ui", "prose", "mono"] as FontAxis[]) {
    const saved = localStorage.getItem(storageKey(axis));
    if (saved && saved !== DEFAULTS[axis]) setFont(axis, saved);
    else fontState[axis] = DEFAULTS[axis];
  }
}
