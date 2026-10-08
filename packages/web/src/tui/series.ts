import type { Tone } from "./tone";

export type Pt = [number, number];

/** A line over the plot's categories: one value per category it has. */
export type SeriesPoint = {
  key: string;
  value: number;
  /** The stretch from this point to the next is drawn dashed: a gap the data bridged. */
  dashed?: boolean;
  /** The stretch from this point to the next takes this colour instead of the series'. */
  tone?: Tone;
};

export type Series = {
  key: string;
  label: string;
  tone: Tone;
  points: SeriesPoint[];
};

/** A stretch of a line that is drawn the same way throughout. */
export type Run = { pts: Pt[]; dashed: boolean; tone?: Tone };

/**
 * The line cut into runs. A segment takes its style from the point it leaves,
 * and neighbouring runs share the point where they meet, so the line stays one
 * line wherever its style changes.
 */
export function lineRuns(
  points: SeriesPoint[],
  at: (point: SeriesPoint) => Pt,
): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const dashed = Boolean(from.dashed);
    const last = runs[runs.length - 1];
    if (last && last.dashed === dashed && last.tone === from.tone)
      last.pts.push(at(points[i + 1]));
    else
      runs.push({
        pts: [at(from), at(points[i + 1])],
        dashed,
        tone: from.tone,
      });
  }
  return runs;
}

const n = (v: number) => Math.round(v * 100) / 100;

export const linePath = (pts: Pt[]) =>
  pts.map(([x, y], i) => `${i ? "L" : "M"}${n(x)} ${n(y)}`).join(" ");

/** The line closed down to `base`, for a filled area under it. */
export function areaPath(pts: Pt[], base: number) {
  if (!pts.length) return "";
  const first = pts[0];
  const last = pts[pts.length - 1];
  return `${linePath(pts)} L${n(last[0])} ${n(base)} L${n(first[0])} ${n(base)} Z`;
}

/** The series still shown, so a legend toggle takes a line out of the scale as well as off the page. */
export const visible = (series: Series[], hidden: string[]) =>
  series.filter((s) => !hidden.includes(s.key));

export const seriesMax = (series: Series[]) =>
  Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.value)));

/** Where a series' points sit on the plot, in the order given. */
export const seriesPoints = (
  s: Series,
  x: (key: string) => number,
  y: (value: number) => number,
): Pt[] => s.points.map((p) => [x(p.key), y(p.value)]);

/** The span of categories between two keys, whichever way round they were given. */
export function keySpan(
  keys: string[],
  a: string,
  b: string,
): [number, number] | null {
  const i = keys.indexOf(a);
  const j = keys.indexOf(b);
  if (i < 0 || j < 0) return null;
  return i <= j ? [i, j] : [j, i];
}
