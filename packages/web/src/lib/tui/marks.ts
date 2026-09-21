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
};

/** A row in a ranked list. Its value is printed, so it needs no axis. */
export type Bar = {
  key: string;
  label: string;
  value: number;
  tone?: Tone;
  /** Stacks the bar, left first. */
  parts?: Part[];
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
