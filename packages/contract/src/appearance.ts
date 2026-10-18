/**
 * The look a deployment gives a person who has not picked their own. A
 * person's choices stay in their browser (dates in their account); a default
 * fills only the fields they have not set.
 */
import { CLOCKS, DATE_ORDERS, type Clock, type DateOrder } from "./dates";

export const THEMES = ["dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

export const TEXT_SIZES = [
  { key: "small", scale: 0.9 },
  { key: "normal", scale: 1 },
  { key: "large", scale: 1.35 },
] as const;
export type TextSize = (typeof TEXT_SIZES)[number]["key"];

/** How the nav and subnav tabs are labelled. One setting covers both bars. */
export const NAV_LABELS = ["text", "both", "icons"] as const;
export type NavLabels = (typeof NAV_LABELS)[number];

/** The faces each axis offers. The SPA owns their stacks and loaders. */
export const FONT_KEYS = {
  ui: ["plex-sans", "inter", "source-sans", "atkinson", "system"],
  prose: ["match", "source-serif", "literata", "plex-sans"],
  mono: ["plex-mono", "jetbrains", "cascadia"],
} as const;
export type FontAxis = keyof typeof FONT_KEYS;
export type FontKey<A extends FontAxis> = (typeof FONT_KEYS)[A][number];

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/** Every field optional: an absent one is the built-in value. */
export interface AppearanceDefaults {
  theme?: Theme;
  text_size?: TextSize;
  nav_labels?: NavLabels;
  accent?: string;
  /** The far end of the accent gradient. Kept only beside `accent`. */
  accent2?: string;
  font_ui?: FontKey<"ui">;
  font_prose?: FontKey<"prose">;
  font_mono?: FontKey<"mono">;
  date_order?: DateOrder;
  clock?: Clock;
}

const oneOf =
  (values: readonly unknown[]) =>
  (value: unknown): boolean =>
    values.includes(value);

const VALID: Record<keyof AppearanceDefaults, (value: unknown) => boolean> = {
  theme: oneOf(THEMES),
  text_size: oneOf(TEXT_SIZES.map((size) => size.key)),
  nav_labels: oneOf(NAV_LABELS),
  accent: isHexColor,
  accent2: isHexColor,
  font_ui: oneOf(FONT_KEYS.ui),
  font_prose: oneOf(FONT_KEYS.prose),
  font_mono: oneOf(FONT_KEYS.mono),
  date_order: oneOf(DATE_ORDERS),
  clock: oneOf(CLOCKS),
};

/** Keeps the fields holding a valid value and drops the rest. */
export function parseAppearanceDefaults(raw: unknown): AppearanceDefaults {
  if (!raw || typeof raw !== "object") return {};
  const fields = raw as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const [field, valid] of Object.entries(VALID)) {
    if (valid(fields[field])) kept[field] = fields[field];
  }
  if (!("accent" in kept)) delete kept.accent2;
  return kept as AppearanceDefaults;
}
