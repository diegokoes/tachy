/**
 * The arithmetic behind a plot: domains, ticks, gutters, stacking.
 *
 * Separate from the components so it can be tested without a DOM, and so the
 * two marks that share a scale cannot drift apart in how they round it.
 */
import { nice as d3Nice, ticks as d3Ticks } from "d3-array";
import type { Part } from "./marks";
import type { Tone } from "./tone";

/**
 * Advance width of a digit in the mono face, in em. tokens.css pins this: Plex
 * Mono sets "0" at 0.600em and the DejaVu Mono fallback at 0.602em, so a
 * substituted glyph still lands in its cell. Measuring text properly would
 * mean a canvas and a reflow; for a gutter of tabular numerals this is exact
 * enough and costs nothing.
 */
export const CH_EM = 0.602;

/** Pixels between the axis line and its labels. */
const TICK_GAP = 4;
/** Length of a tick mark. */
export const TICK_LEN = 4;

/**
 * A measure domain that ends on a round number.
 *
 * Always anchored at zero: these are counts, sizes and durations, and a bar
 * chart whose baseline is not zero misstates every ratio it draws. An
 * all-zero series still gets a domain of [0, 1] so the axis has something to
 * label and the marks divide by a real number.
 */
export function niceDomain(max: number, count = 4): [number, number] {
  const hi = Number.isFinite(max) && max > 0 ? max : 1;
  const [, top] = d3Nice(0, hi, count);
  return [0, top > 0 ? top : 1];
}

/**
 * The values to label, inclusive of both ends where they land round.
 *
 * Fractional ticks are dropped when the top of the axis is a whole number,
 * because almost everything plotted here is a count and "0.6 repos" is not a
 * reading anyone can use. A series that really is fractional (an average
 * duration, a p95) rounds to a fractional top and keeps its steps.
 */
export function tickValues(lo: number, hi: number, count = 4): number[] {
  if (!(hi > lo)) return [lo];
  const all = d3Ticks(lo, hi, count);
  if (!Number.isInteger(hi) || !Number.isInteger(lo)) return all;
  const whole = all.filter(Number.isInteger);
  return whole.length > 1 ? whole : all;
}

/**
 * How many ticks a plot that tall can label without them touching. Two is the
 * floor (an axis showing only its top is not an axis), and five is the
 * ceiling, past which the gridlines start to read as hatching.
 */
export function tickCount(px: number, fsPx: number): number {
  const fits = Math.floor(px / Math.max(1, fsPx * 2.4));
  return Math.max(2, Math.min(5, fits));
}

/** Width the left gutter needs for its widest tick label, in px. */
export function gutterPx(labels: string[], fsPx: number): number {
  const chars = labels.reduce((n, s) => Math.max(n, s.length), 0);
  return Math.ceil(chars * CH_EM * fsPx) + TICK_LEN + TICK_GAP;
}

/**
 * Drops labels until the ones left have room, keeping the first so the series
 * is anchored. Returns the stride, not the labels: the caller still draws
 * every tick, only some without text.
 */
export function labelStride(count: number, px: number, needPx: number): number {
  if (count < 1 || px <= 0 || needPx <= 0) return 1;
  const fits = Math.max(1, Math.floor(px / needPx));
  return Math.max(1, Math.ceil(count / fits));
}

export type Stacked = {
  key: string;
  tone: Tone;
  /** Distance from the baseline to this slice's near edge, in value units. */
  offset: number;
  size: number;
};

/**
 * Cumulative offsets for a stacked mark, zero-valued slices dropped.
 *
 * Dropping them matters beyond tidiness: a zero-height rect still paints its
 * stroke and its rounded corner, so a status with no runs that day would draw
 * a line across the column it is absent from.
 */
export function stackParts(parts: Part[] | undefined): Stacked[] {
  if (!parts?.length) return [];
  const out: Stacked[] = [];
  let at = 0;
  for (const p of parts) {
    if (!(p.value > 0)) continue;
    out.push({ key: p.key, tone: p.tone, offset: at, size: p.value });
    at += p.value;
  }
  return out;
}

/**
 * A tone as a paintable value.
 *
 * An SVG presentation attribute cannot parse a custom property (`fill="var(--ok)"`
 * is inert), so a mark writes this into `style` instead, or wears a class and
 * lets scoped CSS do it.
 */
const SERIES: Record<Tone, string> = {
  accent: "--series",
  info: "--series-2",
  ok: "--series-ok",
  warn: "--series-warn",
  danger: "--series-danger",
  muted: "--muted",
};

/** The chart ink for a tone: the series tokens, never the raw accent or status colours. */
export const toneVar = (t: Tone = "accent") => `var(${SERIES[t]})`;

/** The same tone, thinned towards the ground. */
export const toneMix = (t: Tone, pct: number) =>
  `color-mix(in srgb, ${toneVar(t)} ${Math.max(0, Math.min(100, pct))}%, transparent)`;

/**
 * Intensity steps for the calendar marks, the same five the ASCII ramp in
 * glyphs.ts uses, so a heat cell and a `░▒▓█` bar mean the same thing. One
 * tone thinned five ways, never a second hue: a ramp built from two tokens
 * stops being readable the moment someone picks a new accent.
 */
export const RAMP_STEPS = [12, 30, 50, 72, 100] as const;

/** Which ramp step a value falls in. Zero and below get none. */
export function heatStep(value: number, max: number): number {
  if (!(value > 0) || !(max > 0)) return -1;
  const i = Math.ceil((value / max) * RAMP_STEPS.length) - 1;
  return Math.max(0, Math.min(RAMP_STEPS.length - 1, i));
}

/** A heat cell's fill, or `transparent` where there is nothing to report. */
export function heatFill(value: number, max: number, tone: Tone = "accent") {
  const step = heatStep(value, max);
  return step < 0 ? "transparent" : toneMix(tone, RAMP_STEPS[step]);
}
