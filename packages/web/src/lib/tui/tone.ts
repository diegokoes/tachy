export type Tone = "accent" | "ok" | "warn" | "danger" | "muted" | "info";

const STATUS_TONE: Record<string, "ok" | "warn" | "danger"> = {
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

/** A job or test run that has not finished. */
export const isActive = (status: string | undefined) =>
  status === "queued" || status === "running";
