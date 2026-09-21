/**
 * How many rows of `row` rem, `gap` rem apart, fit the node's height — told to
 * `onfit` now and whenever the node resizes. Measured by hand on mount first: a
 * ResizeObserver only delivers on a rendered frame, and a tab nobody is looking
 * at renders none, which left a chart built there with no rows at all.
 */
export function fitRows(
  node: HTMLElement,
  p: { row: number; gap?: number; onfit: (n: number) => void },
) {
  let opts = p;
  let last = -1;
  const measure = () => {
    const rem =
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const gap = (opts.gap ?? 0) * rem;
    const n = Math.max(
      1,
      Math.floor((node.clientHeight + gap) / (opts.row * rem + gap)),
    );
    if (n !== last) opts.onfit((last = n));
  };
  measure();
  const ro = new ResizeObserver(measure);
  ro.observe(node);
  return {
    update(next: typeof p) {
      opts = next;
      measure();
    },
    destroy: () => ro.disconnect(),
  };
}

/**
 * The node's content box in pixels, told to `onsize` now and on every resize.
 *
 * Measured by hand on mount for the same reason as fitRows, and it is what a
 * plot needs before it can pick a scale: an SVG sized by percentages has no
 * numbers to put a tick at.
 */
export function measureBox(
  node: HTMLElement,
  onsize: (w: number, h: number) => void,
) {
  let tell = onsize;
  let last = "";
  const measure = () => {
    const w = node.clientWidth;
    const h = node.clientHeight;
    const key = `${w}x${h}`;
    if (key === last) return;
    last = key;
    tell(w, h);
  };
  measure();
  const ro = new ResizeObserver(measure);
  ro.observe(node);
  return {
    update(next: typeof onsize) {
      tell = next;
    },
    destroy: () => ro.disconnect(),
  };
}

/** The rows shown when `fit` rows fit: all of them, or all but one plus a "more" row. */
export function fitted<T>(rows: T[], fit: number): { shown: T[]; rest: T[] } {
  const room = Math.max(1, fit);
  if (rows.length <= room) return { shown: rows, rest: [] };
  const shown = rows.slice(0, Math.max(1, room - 1));
  return { shown, rest: rows.slice(shown.length) };
}
