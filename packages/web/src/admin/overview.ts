import { navigate, segment } from "../shell/router.svelte";

/**
 * Leave the overview for one section of the same page. The overview and the
 * sections never share the screen, so this is a route change: the sections
 * mount and open at `key`.
 */
export const showSection = (key: string) =>
  navigate(`/admin/${segment(1) ?? "integrations"}/${key}`);

export type Tone = "accent" | "ok" | "warn" | "danger" | "muted";

export const ratio = (n: number, of: number) => (of ? n / of : 0);

/** "83%", or a dash when there is nothing to take a share of. */
export const pct = (n: number, of: number) =>
  of ? `${Math.round((n / of) * 100)}%` : "–";

/**
 * Readiness: all of it, some of it, none of it - and muted when there is
 * nothing to be ready. The ring colours the part that is done, so a partial
 * state must not paint the finished part red.
 */
export const grade = (done: number, of: number): Tone =>
  !of ? "muted" : done === of ? "ok" : done ? "warn" : "danger";

/** A load against its ceiling: fine, getting close, at it. */
export const load = (share: number): Tone =>
  share >= 0.9 ? "danger" : share >= 0.7 ? "warn" : "ok";

/** "12 min", "5 h", "3 d" - how long ago, or how long up. */
export const span = (ms: number) => {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
};

export const age = (iso: string | null | undefined, now = Date.now()) => {
  const atMs = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(atMs) ? span(now - atMs) : null;
};

/** "2m 10s", "45s", "1h 5m". */
export const duration = (seconds: number) => {
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes}m ${whole % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"];

/** 1536 → "1.5 KiB". */
export const bytes = (n: number) => {
  let value = n;
  let i = 0;
  while (value >= 1024 && i < UNITS.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${UNITS[i]}`;
};

export type Count = {
  key: string;
  label: string;
  value?: number;
  /** Printed instead of `value`: a state, an age, a compacted figure. */
  text?: string;
  tone?: "accent" | "ok" | "warn" | "danger" | "muted";
  /** The section on this page this figure is the count of. */
  to?: string;
  /** The key of the counter this one breaks down; it must follow it. */
  of?: string;
};

export type CountGroup = { head: Count; parts: Count[] };

/**
 * Counters in the order given, each one followed by the counters that break
 * it down. A part whose parent is not the counter before it stands alone.
 */
export const groupCounts = (counts: Count[]): CountGroup[] => {
  const groups: CountGroup[] = [];
  for (const count of counts) {
    const last = groups[groups.length - 1];
    if (count.of && last?.head.key === count.of) last.parts.push(count);
    else groups.push({ head: count, parts: [] });
  }
  return groups;
};
