import { CH_EM } from "./scale";

export type TipLine = { label: string; value: string };

const PAD = 6;
const GAP = 10;

/** The box a tooltip needs for its lines, from the width of a mono character. */
export function tooltipSize(
  title: string | undefined,
  lines: TipLine[],
  fs: number,
) {
  const rows = (title ? 1 : 0) + lines.length;
  const longest = Math.max(
    title?.length ?? 0,
    ...lines.map((l) => l.label.length + l.value.length + 2),
  );
  return {
    w: Math.ceil(longest * CH_EM * fs) + PAD * 2,
    h: Math.ceil(rows * fs * 1.45) + PAD * 2,
  };
}

/**
 * Beside the anchor on the side with room - right and above by default, flipped
 * when that would leave the plot - and clamped inside it as a last resort.
 */
export function tooltipAt(
  anchor: { x: number; y: number },
  box: { w: number; h: number },
  area: { w: number; h: number },
) {
  let x = anchor.x + GAP;
  if (x + box.w > area.w) x = anchor.x - GAP - box.w;
  let y = anchor.y - GAP - box.h;
  if (y < 0) y = anchor.y + GAP;
  return {
    x: Math.max(0, Math.min(x, area.w - box.w)),
    y: Math.max(0, Math.min(y, area.h - box.h)),
  };
}

export const TIP_PAD = PAD;
