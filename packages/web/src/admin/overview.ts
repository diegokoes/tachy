import { navigate, segment } from "../shell/router.svelte";

/**
 * Leave the overview for one section of the same page. The overview and the
 * sections never share the screen, so this is a route change: the sections
 * mount and open at `key`.
 */
export const showSection = (key: string) =>
  navigate(`/console/${segment(1) ?? "integrations"}/${key}`);

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
export const grade = (done: number, of: number): Tone => {
  if (!of) return "muted";
  if (done === of) return "ok";
  return done ? "warn" : "danger";
};

const LOAD_AT_CEILING = 0.9;
const LOAD_CLOSE = 0.7;

/** A load against its ceiling: fine, getting close, at it. */
export const load = (share: number): Tone => {
  if (share >= LOAD_AT_CEILING) return "danger";
  return share >= LOAD_CLOSE ? "warn" : "ok";
};

const MINUTE_SECONDS = 60;
const HOUR_MINUTES = 60;
const HOURS_SHOWN_BELOW = 48;

/** "12 min", "5 h", "3 d" - how long ago, or how long up. */
export const span = (ms: number) => {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < HOUR_MINUTES) return `${min} min`;
  const h = Math.round(min / HOUR_MINUTES);
  return h < HOURS_SHOWN_BELOW ? `${h} h` : `${Math.round(h / 24)} d`;
};

export const age = (iso: string | null | undefined, now = Date.now()) => {
  const atMs = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(atMs) ? span(now - atMs) : null;
};

/** "2m 10s", "45s", "1h 5m". */
export const duration = (seconds: number) => {
  const whole = Math.round(seconds);
  if (whole < MINUTE_SECONDS) return `${whole}s`;
  const minutes = Math.floor(whole / MINUTE_SECONDS);
  if (minutes < HOUR_MINUTES) return `${minutes}m ${whole % MINUTE_SECONDS}s`;
  return `${Math.floor(minutes / HOUR_MINUTES)}h ${minutes % HOUR_MINUTES}m`;
};

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"];
const UNIT_STEP = 1024;
const ONE_DECIMAL_BELOW = 10;

/** 1536 → "1.5 KiB". */
export const bytes = (n: number) => {
  let value = n;
  let i = 0;
  while (value >= UNIT_STEP && i < UNITS.length - 1) {
    value /= UNIT_STEP;
    i++;
  }
  return `${value >= ONE_DECIMAL_BELOW || i === 0 ? Math.round(value) : value.toFixed(1)} ${UNITS[i]}`;
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
