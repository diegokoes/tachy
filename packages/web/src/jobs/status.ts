import type { JobRunListed, JobStatus, JobTrigger } from "@tachy/contract";
import type { Tone } from "../tui";
import type { IconName } from "../tui/icons";
import { span } from "../admin/overview";

export const STATUS_MARK: Record<
  JobStatus,
  { icon: IconName; tone: Tone; label: string }
> = {
  queued: { icon: "runQueued", tone: "muted", label: "waiting" },
  running: { icon: "runRunning", tone: "accent", label: "running" },
  succeeded: { icon: "success", tone: "ok", label: "succeeded" },
  failed: { icon: "runFailed", tone: "danger", label: "failed" },
  cancelled: { icon: "runCancelled", tone: "muted", label: "stopped" },
  timed_out: { icon: "runTimedOut", tone: "danger", label: "timed out" },
};

export const statusMark = (status: string) =>
  STATUS_MARK[status as JobStatus] ?? {
    icon: "runQueued" as IconName,
    tone: "muted" as Tone,
    label: status.replaceAll("_", " "),
  };

const TRIGGER_ICON: Record<JobTrigger, IconName> = {
  schedule: "startedBySchedule",
  manual: "startedByPerson",
  event: "startedByEvent",
};

/** What starts a run of these kinds when nothing queued them from a parent run. */
const EVENT_SOURCE: Record<string, string> = {
  "flow.run": "flow trigger",
  "bucket.embed": "upload",
};

/**
 * Who or what started a run, for its "started by" cell. An event names the run
 * that queued it, else the thing that fires that kind, else only that
 * something did.
 */
export function startedBy(
  run: Pick<
    JobRunListed,
    | "trigger"
    | "kind"
    | "requested_by_name"
    | "parent_id"
    | "parent_kind"
    | "parent_name"
  >,
  titleOf: (kind: string) => string,
): { icon: IconName; who: string } {
  const icon = TRIGGER_ICON[run.trigger];
  if (run.trigger === "schedule") return { icon, who: "schedule" };
  if (run.trigger === "manual")
    return { icon, who: run.requested_by_name ?? "someone" };
  if (run.parent_id)
    return {
      icon,
      who:
        run.parent_name ??
        (run.parent_kind ? titleOf(run.parent_kind) : "another run"),
    };
  return { icon, who: EVENT_SOURCE[run.kind] ?? "an event" };
}

/** The result cell of a run that has not started: how long, and which try. */
export function waitingText(
  run: Pick<
    JobRunListed,
    "run_after" | "created_at" | "attempts" | "max_attempts"
  >,
  now: number,
): string {
  if (run.attempts > 0)
    return `retry ${run.attempts + 1} of ${run.max_attempts}`;
  const from = Date.parse(run.run_after || run.created_at);
  const ms = Number.isFinite(from) ? now - from : 0;
  return ms < 60_000 ? "waiting" : `waiting ${span(ms)}`;
}

/** The health mark of a job: how its last run ended, and how long ago. */
export function lastResult(
  last: { status: string; created_at: string } | null,
  now: number,
): { icon: IconName; tone: Tone; text: string; short: string } {
  if (!last)
    return {
      icon: "runQueued",
      tone: "muted",
      text: "never run",
      short: "never",
    };
  const mark = statusMark(last.status);
  const at = Date.parse(last.created_at);
  const ago = Number.isFinite(at) ? `${span(now - at)} ago` : "";
  const running = last.status === "running";
  return {
    icon: mark.icon,
    tone: mark.tone,
    text: running ? "running" : `${mark.label} ${ago}`.trim(),
    short: running ? "running" : ago,
  };
}

/** A log is worth a button once it says more than the result line does. */
export const hasLog = (logTail: string) => logTail.trim().includes("\n");
