/**
 * The job layer's vocabulary (DEPLOYMENT-ARCHITECTURE.md §5.3). Kinds are
 * defined in code; definitions are rows an admin configures; runs are what the
 * scheduler, an event or a button creates.
 */
export const JOB_TRIGGERS = ["schedule", "manual", "event"] as const;
export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
] as const;
/** Worker pools declared in Compose. Each pool claims only its own class. */
export const JOB_RESOURCE_CLASSES = ["light", "heavy"] as const;
/** What happens when a schedule fires while the previous run is still going. */
export const JOB_OVERLAP = ["skip", "queue"] as const;
/** What happens to a firing the host was down for. */
export const JOB_MISSED = ["run-once", "skip"] as const;
export const JOB_NOTIFY = ["failure", "always", "never"] as const;

/** Chat slots a running job of each class holds (§5.3.4). */
export const JOB_CLASS_CHAT_SLOTS: Record<JobResourceClass, number> = {
  light: 0,
  heavy: 3,
};

export type JobTrigger = (typeof JOB_TRIGGERS)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobResourceClass = (typeof JOB_RESOURCE_CLASSES)[number];
export type JobOverlap = (typeof JOB_OVERLAP)[number];
export type JobMissed = (typeof JOB_MISSED)[number];
export type JobNotify = (typeof JOB_NOTIFY)[number];

export const JOB_FINISHED: readonly JobStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
];

/** "90s", "15m", "2h", "1d" → milliseconds. */
export function parseDuration(text: string): number {
  const m = /^(\d+)\s*(s|m|h|d)$/.exec(text.trim());
  if (!m)
    throw new Error(`'${text}' is not a duration like 90s, 15m, 2h or 1d`);
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
    m[2] as "s" | "m" | "h" | "d"
  ];
  return Number(m[1]) * unit;
}

export interface JobCensus {
  days: number;
  runs: number;
  by_status: Record<JobStatus, number>;
  by_trigger: Record<JobTrigger, number>;
  by_class: Record<JobResourceClass, number>;
  /** Runs created per day, oldest first, gaps filled. */
  per_day: ({ day: string } & Record<JobStatus, number>)[];
  /** Busiest kinds first. `avg_seconds` covers runs that started and finished. */
  by_kind: {
    kind: string;
    runs: number;
    succeeded: number;
    failed: number;
    avg_seconds: number | null;
  }[];
  /** Finished runs and how many of them succeeded, per pool. */
  success: Record<JobResourceClass, { finished: number; succeeded: number }>;
  now: Record<JobResourceClass, { running: number; queued: number }>;
  definitions: {
    total: number;
    enabled: number;
    scheduled: number;
    manual: number;
    disabled: number;
    /**
     * Definitions per worker pool, by the class each actually runs on: its
     * own override, else its kind's default. Counts jobs, not runs; the runs
     * per pool are already in `success`.
     */
    by_class: Record<JobResourceClass, number>;
  };
  /**
   * Failed and timed-out runs in the window, one row per job that failed.
   * A run with no definition (an ad-hoc run) is grouped under its kind.
   */
  failures: {
    definition_id: string | null;
    name: string;
    kind: string;
    runs: number;
    last_at: string;
    last_error: string | null;
    last_run: string;
  }[];
  /** Fire times in the next 24 hours, per enabled scheduled definition. */
  upcoming: { id: string; name: string; kind: string; at: string[] }[];
}

export interface JobRun {
  id: string;
  definition_id: string | null;
  kind: string;
  params: Record<string, unknown>;
  resource_class: JobResourceClass;
  trigger: JobTrigger;
  scheduled_for: string | null;
  requested_by: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  timeout_ms: number;
  run_after: string;
  locked_by: string | null;
  locked_until: string | null;
  cancel_requested: boolean;
  progress: number | null;
  progress_note: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
  log_tail: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobDefinition {
  id: string;
  kind: string;
  name: string;
  params: Record<string, unknown>;
  enabled: boolean;
  schedule: string | null;
  timezone: string;
  resource_class: JobResourceClass | null;
  timeout: string | null;
  overlap: JobOverlap | null;
  notify: JobNotify;
  last_scheduled_for: string | null;
  disabled_reason: string | null;
  created_at: string;
  updated_at: string;
}
