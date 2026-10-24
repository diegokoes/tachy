import type { Lamp } from "./lamp";

/** `alt` is a third series colour with no status meaning, for charts only. */
export type Tone =
  "accent" | "ok" | "warn" | "danger" | "muted" | "info" | "alt";

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "accent"> = {
  running: "accent",
  ok: "ok",
  pass: "ok",
  passed: "ok",
  succeeded: "ok",
  warn: "warn",
  fail: "danger",
  failed: "danger",
  error: "danger",
  timed_out: "danger",
};

/** Badge tone for a check, job run or test run status. Unlisted statuses are muted. */
export const toneOf = (status: string | undefined) =>
  (status && STATUS_TONE[status]) || "muted";

/** A check, job run or test run status as a lamp: half while it runs, lit once it has an outcome. */
export function lampOf(status: string | undefined): Lamp {
  const tone = toneOf(status);
  if (status === "running") return { level: "half", tone };
  return { level: status && STATUS_TONE[status] ? "on" : "off", tone };
}

/** A job or test run that has not finished. */
export const isActive = (status: string | undefined) =>
  status === "queued" || status === "running";
