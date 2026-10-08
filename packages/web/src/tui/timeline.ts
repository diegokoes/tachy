const MINUTE_MS = 60_000;

/** How far off a firing is, in the shortest words that stay exact: "now", "12 min", "3 h 05", "2 d". */
export function until(ms: number): string {
  if (ms < MINUTE_MS) return "now";
  const min = Math.round(ms / MINUTE_MS);
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
  const delta = Date.parse(iso) - now;
  return delta >= 0 && delta <= within;
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
  const marks: { at: number; label: string }[] = [];
  const cursor = new Date(from);
  cursor.setMinutes(0, 0, 0);
  cursor.setHours(Math.ceil(from.getHours() / step) * step);
  if (cursor.getTime() < from.getTime())
    cursor.setHours(cursor.getHours() + step);
  const end = from.getTime() + hours * 3_600_000;
  for (; cursor.getTime() < end; cursor.setHours(cursor.getHours() + step))
    marks.push({
      at: ((cursor.getTime() - from.getTime()) / (end - from.getTime())) * 100,
      label: clock(cursor),
    });
  return marks;
}
