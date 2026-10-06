/** A waffle is `total` equal cells in a box, the first `lit` of them filled from the bottom left. */
export type WaffleGrid = {
  cols: number;
  rows: number;
  /** Side of one cell, in px. */
  size: number;
  gap: number;
};

/**
 * The column count that makes the cells largest, so a wide box gets a wide
 * waffle and a tall one a tall waffle. Ties go to fewer columns.
 */
export function waffleGrid(
  w: number,
  h: number,
  total: number,
  gap = 2,
): WaffleGrid {
  const n = Math.max(1, Math.floor(total));
  let best: WaffleGrid = { cols: 1, rows: n, size: 0, gap };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const size = Math.floor(
      Math.min((w - gap * (cols - 1)) / cols, (h - gap * (rows - 1)) / rows),
    );
    if (size > best.size) best = { cols, rows, size, gap };
  }
  return best;
}

/** Top left of cell `i`, counted from the bottom left and row by row upward. */
export function waffleCell(g: WaffleGrid, i: number): { x: number; y: number } {
  const col = i % g.cols;
  const row = Math.floor(i / g.cols);
  return {
    x: col * (g.size + g.gap),
    y: (g.rows - 1 - row) * (g.size + g.gap),
  };
}

/** Whole percent, or 0 when there is no whole to take a share of. */
export const waffleShare = (lit: number, total: number) =>
  total > 0 ? Math.round((lit / total) * 100) : 0;

/** The geometry of bars drawn as cells: how big a cell is, how many fill a column, what one cell stands for. */
export type BarsGrid = {
  /** Side of one cell, in px. */
  size: number;
  gap: number;
  /** Cells stacked in one column of a bar. */
  per: number;
  /** Columns that fit across the plot. */
  cols: number;
  /** What one cell counts. */
  unit: number;
};

const UNITS = [1, 2, 5];

/** The smallest 1, 2, 5, 10, 20, 50... that is at least `x`, so an axis in cells reads in round numbers. */
export function niceUnit(x: number): number {
  if (!(x > 1)) return 1;
  const pow = 10 ** Math.floor(Math.log10(x));
  for (const m of UNITS) if (m * pow >= x) return m * pow;
  return 10 * pow;
}

/**
 * Cells for `n` bars in a `w` x `h` box: as many to a column as the bar's
 * height holds at a legible size, and a unit chosen so the longest bar just
 * fits the width.
 */
export function waffleBarsGrid(
  w: number,
  h: number,
  n: number,
  max: number,
  gap = 2,
): BarsGrid {
  const band = n > 0 ? h / n : h;
  const bar = Math.max(0, band * 0.8);
  const per = Math.max(1, Math.min(4, Math.floor((bar + gap) / 12)));
  const size = Math.max(
    0,
    Math.min(16, Math.floor((bar - gap * (per - 1)) / per)),
  );
  const cols = size > 0 ? Math.max(1, Math.floor((w + gap) / (size + gap))) : 0;
  const unit = cols ? niceUnit(max / (cols * per)) : 1;
  return { size, gap, per, cols, unit };
}

/** Cells a bar of `value` takes: at least one while it is not zero. */
export const waffleCount = (value: number, unit: number) =>
  value > 0 ? Math.max(1, Math.round(value / unit)) : 0;

/** Top left of cell `i` of a bar, filled down a column and then across. */
export function waffleBarCell(g: BarsGrid, i: number) {
  return {
    x: Math.floor(i / g.per) * (g.size + g.gap),
    y: (i % g.per) * (g.size + g.gap),
  };
}
