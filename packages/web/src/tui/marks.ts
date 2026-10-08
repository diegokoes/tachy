/**
 * What a chart is given to draw.
 *
 * These shapes live apart from the components that render them so a mark and
 * the frame it sits in can both name them without importing each other. The
 * field names are the ones the panels already pass; nothing here is new.
 */
import type { Tone } from "./tone";

/** One slice of a stacked mark. Their sum is the row's `value`. */
export type Part = { key: string; value: number; tone: Tone };

/** A column: one band on the category axis, measured up the value axis. */
export type Col = {
  key: string;
  label: string;
  value: number;
  tone?: Tone;
  /** Stacks the column, bottom first. */
  parts?: Part[];
  /** Spelled out on hover, where the label is only a day of the month. */
  title?: string;
  /** Printed on top instead of the value: "fail" on a run that has none. */
  text?: string;
  /** A reference drawn as a faint wide bar behind the column: a baseline, a quota, the last period. */
  behind?: number;
  /** A narrower bar drawn inside the column from its base: the part of it that went wrong. */
  inner?: Part[];
};

/** One named series: its swatch colour and the words beside it. */
export type LegendItem = { key: string; label: string; tone: Tone };

/** A row in a ranked list. Its value is printed, so it needs no axis. */
export type Bar = {
  key: string;
  label: string;
  value: number;
  tone?: Tone;
  /** Stacks the bar, left first. */
  parts?: Part[];
  /** A thinner bar drawn inside this one from its left: the part of it that went wrong. */
  inner?: Part[];
  /** A second figure after the count, in the same row: the average beside the total. */
  aside?: string;
};

/** One part of a population drawn as a share of the whole. */
export type Segment = { key: string; label: string; n: number; tone: Tone };

/** A lamp on a status board. */
export type Cell = {
  key: string;
  label: string;
  tone: "ok" | "warn" | "danger" | "muted";
  /** The reading behind the state: "42%", "keyed by TACHY_SECRET_KEY". */
  title?: string;
};

/** One day's total, for the calendar marks. */
export type Day = {
  key: string;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  value: number;
  title?: string;
};

/**
 * A block of a treemap, and the blocks nested in it. A leaf's area is its
 * `size`, one unless given, so a group's area counts the leaves under it.
 */
export type Block = {
  /** Unique across the whole tree, not only among siblings. */
  key: string;
  label: string;
  /** A leaf's heat; a group's figure, printed in its header. */
  value: number;
  size?: number;
  /** Spelled out on hover. */
  title?: string;
  children?: Block[];
};

/** A share of a whole, told as a row: how much of it is done, and out of what. */
export type Ratio = {
  key: string;
  label: string;
  /** 0-1. */
  value: number;
  tone: Tone;
  /** Paints the unlit part too, for a split where neither side is missing. */
  rest?: Tone;
  /** The percentage, or whatever stands for the share in one word. */
  center: string;
  /** Beside it, usually "12/15". */
  sub?: string;
  /** What the row measures, in full. */
  title?: string;
  onclick?: () => void;
};
