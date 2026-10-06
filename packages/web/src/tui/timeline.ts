/** How far off a firing is, in the shortest words that stay exact: "now", "12 min", "3 h 05", "2 d". */
export function until(ms: number): string {
  if (ms < 60_000) return "now";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, "0")}`;
  return `${Math.round(h / 24)} d`;
}

/** The first firing that has not happened yet, as an index into `at` (sorted), or -1. */
export function nextIndex(at: string[], now: number): number {
  return at.findIndex((t) => Date.parse(t) >= now);
}

/** Within the hour: close enough to be worth a brighter tick. */
export const isSoon = (iso: string, now: number, within = 3_600_000) => {
  const d = Date.parse(iso) - now;
  return d >= 0 && d <= within;
};

/** "14:30" in the viewer's clock, which is what a schedule is read against. */
export const clock = (d: Date) =>
  d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/**
 * Where the clock's round hours fall on an axis that starts at `from`: every
 * `step` hours on the local clock, as a share of the span, so a firing can be
 * read against a time a person would say.
 */
export function hourMarks(from: Date, hours: number, step = 6) {
  const out: { at: number; label: string }[] = [];
  const t = new Date(from);
  t.setMinutes(0, 0, 0);
  t.setHours(Math.ceil(from.getHours() / step) * step);
  if (t.getTime() < from.getTime()) t.setHours(t.getHours() + step);
  const end = from.getTime() + hours * 3_600_000;
  for (; t.getTime() < end; t.setHours(t.getHours() + step))
    out.push({
      at: ((t.getTime() - from.getTime()) / (end - from.getTime())) * 100,
      label: clock(t),
    });
  return out;
}
