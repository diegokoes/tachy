import type { Freshness } from "@tachy/contract";
import { ageHours } from "../admin/detail";

/** How stale a thing is, in the bands an admin reads it by. */
export const FRESHNESS_BANDS = [
  { key: "hour", label: "< 1 h", under: 1 },
  { key: "six", label: "< 6 h", under: 6 },
  { key: "day", label: "< 1 d", under: 24 },
  { key: "three", label: "< 3 d", under: 72 },
  { key: "week", label: "< 7 d", under: 168 },
  { key: "older", label: "older", under: Infinity },
  { key: "never", label: "never", under: Infinity },
] as const;

export const FRESHNESS_KINDS = [
  { key: "source", label: "sources", tone: "accent" },
  { key: "repo", label: "repos", tone: "info" },
  { key: "bucket", label: "buckets", tone: "muted" },
] as const;

/** Which band a timestamp falls in; a thing that never ran has its own. */
export function band(iso: string | null, now = Date.now()): string {
  const h = ageHours(iso, now);
  if (h === null) return "never";
  return FRESHNESS_BANDS.find((b) => h < b.under && b.key !== "never")!.key;
}

/** Everything counted into the bands, split by what kind of thing it is. */
export function freshnessBands(rows: Freshness[], now = Date.now()) {
  return FRESHNESS_BANDS.map((b) => {
    const here = rows.filter((r) => band(r.last_at, now) === b.key);
    return {
      key: b.key,
      label: b.label,
      value: here.length,
      parts: FRESHNESS_KINDS.map((k) => ({
        key: k.key,
        value: here.filter((r) => r.kind === k.key).length,
        tone: k.tone,
      })),
    };
  });
}

/** What a band says about a thing: fine, ageing, neglected, or never run. */
export const FRESHNESS_STATES = [
  { key: "fresh", label: "< 1 d", tone: "ok" },
  { key: "week", label: "< 7 d", tone: "accent" },
  { key: "older", label: "older", tone: "warn" },
  { key: "never", label: "never", tone: "danger" },
] as const;

const STATE_OF: Record<string, (typeof FRESHNESS_STATES)[number]["key"]> = {
  hour: "fresh",
  six: "fresh",
  day: "fresh",
  three: "week",
  week: "week",
  older: "older",
  never: "never",
};

export const freshnessState = (iso: string | null, now = Date.now()) =>
  STATE_OF[band(iso, now)];

/** Every tracked thing as a cell, grouped by kind, the stalest last in each. */
export function freshnessGroups(rows: Freshness[], now = Date.now()) {
  return FRESHNESS_KINDS.map((k) => ({
    key: k.key,
    label: k.label,
    items: rows
      .filter((r) => r.kind === k.key)
      .map((r) => {
        const state = freshnessState(r.last_at, now);
        return {
          key: `${r.kind}:${r.key}`,
          label: r.label,
          tone: FRESHNESS_STATES.find((s) => s.key === state)!.tone,
          title: `${r.label}: ${r.last_at ? new Date(r.last_at).toLocaleString() : "never"}`,
        };
      }),
  }));
}
