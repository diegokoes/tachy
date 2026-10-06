import { ticks } from "d3-array";

/** Spoke `i` of `n`, in radians: the first points straight up and the rest follow clockwise. */
export const radarAngle = (i: number, n: number) =>
  -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);

export function radarPoint(i: number, n: number, r: number) {
  const a = radarAngle(i, n);
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

const round = (v: number) => Math.round(v * 100) / 100;

/** A closed outline through one value per spoke, on a scale that puts `max` at `radius`. */
export function radarPath(values: number[], max: number, radius: number) {
  if (!values.length) return "";
  return `${values
    .map((v, i) => {
      const p = radarPoint(
        i,
        values.length,
        (Math.max(0, v) / (max || 1)) * radius,
      );
      return `${i ? "L" : "M"}${round(p.x)} ${round(p.y)}`;
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

/** Which side of its spoke's end a label sits on, so it reads away from the centre. */
export function radarAnchor(i: number, n: number): "start" | "middle" | "end" {
  const c = Math.cos(radarAngle(i, n));
  return c > 0.25 ? "start" : c < -0.25 ? "end" : "middle";
}

/** The top of the scale: the largest value, rounded up to the last ring. */
export function radarMax(values: number[]): number {
  const top = Math.max(0, ...values);
  const rings = radarTicks(top, 3);
  const last = rings[rings.length - 1] ?? 0;
  return last >= top ? last : top;
}
