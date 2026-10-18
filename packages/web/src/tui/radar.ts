import { ticks } from "d3-array";

/** Spoke `i` of `n`, in radians: the first points straight up and the rest follow clockwise. */
export const radarAngle = (i: number, n: number) =>
  -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);

export function radarPoint(i: number, n: number, r: number) {
  const angle = radarAngle(i, n);
  return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
}

const round = (v: number) => Math.round(v * 100) / 100;

/** A closed outline through one value per spoke, on a scale that puts `max` at `radius`. */
export function radarPath(values: number[], max: number, radius: number) {
  if (!values.length) return "";
  return `${values
    .map((value, i) => {
      const point = radarPoint(
        i,
        values.length,
        (Math.max(0, value) / (max || 1)) * radius,
      );
      return `${i ? "L" : "M"}${round(point.x)} ${round(point.y)}`;
    })
    .join(" ")} Z`;
}

/** The outline of one ring of the grid: every spoke at the same distance. */
export const radarRing = (n: number, radius: number) =>
  radarPath(Array(n).fill(1), 1, radius);

/** Rings worth drawing for values up to `max`: round numbers, never zero. */
export function radarTicks(max: number, count = 3): number[] {
  return max > 0 ? ticks(0, max, count).filter((t) => t > 0) : [];
}

/** From a spoke's tip to its label, in ems. */
export const RADAR_LABEL_GAP = 0.9;
/** From a label's line to the value printed under it, in ems. */
export const RADAR_LINE = 1.15;
/** One line of glyphs, ascender to descender, in ems. */
const GLYPH_EM = 1.25;

/**
 * Height kept above and below the rings for the labels at the top and bottom
 * spokes, in px: the gap, then `lines` lines of text, the value under the label
 * when one series is drawn.
 */
export const radarReserve = (fs: number, lines: number) =>
  fs * (RADAR_LABEL_GAP + (Math.max(1, lines) - 1) * RADAR_LINE + GLYPH_EM);

/** Past this cosine a spoke leans far enough sideways for its label to sit beside it. */
const SIDE_COSINE = 0.25;

/** Which side of its spoke's end a label sits on, so it reads away from the centre. */
export function radarAnchor(i: number, n: number): "start" | "middle" | "end" {
  const cosine = Math.cos(radarAngle(i, n));
  if (cosine > SIDE_COSINE) return "start";
  return cosine < -SIDE_COSINE ? "end" : "middle";
}

/** The top of the scale: the largest value, rounded up to the last ring. */
export function radarMax(values: number[]): number {
  const top = Math.max(0, ...values);
  const rings = radarTicks(top, 3);
  const last = rings[rings.length - 1] ?? 0;
  return last >= top ? last : top;
}
