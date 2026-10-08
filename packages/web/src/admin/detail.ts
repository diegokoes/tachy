import type { Column } from "../tui";

/** Totals worth printing over a series of per-day counts. */
export type SeriesStats = {
  total: number;
  /** Per day, over every day in the series, empty ones included. */
  mean: number;
  peak: { label: string; value: number } | null;
  /** The later half against the earlier half, as a fraction; null when there is no earlier half to compare. */
  change: number | null;
};

export function seriesStats(
  rows: { label: string; value: number }[],
): SeriesStats {
  const total = rows.reduce((n, r) => n + r.value, 0);
  const peak = rows.reduce<SeriesStats["peak"]>(
    (best, r) => (!best || r.value > best.value ? r : best),
    null,
  );
  const half = Math.floor(rows.length / 2);
  const before = rows.slice(0, half).reduce((n, r) => n + r.value, 0);
  const after = rows.slice(rows.length - half).reduce((n, r) => n + r.value, 0);
  return {
    total,
    mean: rows.length ? total / rows.length : 0,
    peak:
      peak && peak.value > 0 ? { label: peak.label, value: peak.value } : null,
    change: half && before ? (after - before) / before : null,
  };
}

/** "+12%", "-8%", or a dash when there is nothing to compare. */
export const signed = (fraction: number | null) =>
  fraction === null
    ? "–"
    : `${fraction > 0 ? "+" : ""}${Math.round(fraction * 100)}%`;

/** A column that prints a value, for the tables where nothing needs a snippet. */
export const col = <T>(
  key: string,
  label: string,
  get: (row: T) => string | number,
  o: { width?: string; end?: boolean } = {},
): Column<T> => ({
  key,
  label,
  value: get,
  width: o.width,
  align: o.end ? "end" : undefined,
});

const HOUR_MINUTES = 60;
const HOURS_SHOWN_BELOW = 48;
const ONE_DECIMAL_BELOW = 10;

/** "3.2 h ago", "12 min ago", "never" - how stale a timestamp is. */
export function ago(iso: string | null, now = Date.now()) {
  if (!iso) return "never";
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < HOUR_MINUTES) return `${min} min ago`;
  const h = min / HOUR_MINUTES;
  if (h < HOURS_SHOWN_BELOW)
    return `${h < ONE_DECIMAL_BELOW ? h.toFixed(1) : Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Age in whole hours, or null for one that never happened. */
export const ageHours = (iso: string | null, now = Date.now()) =>
  iso ? Math.max(0, (now - Date.parse(iso)) / 3_600_000) : null;

/** Days a tile shows of a series the detail view can take further back. */
export const TILE_DAYS = 14;
