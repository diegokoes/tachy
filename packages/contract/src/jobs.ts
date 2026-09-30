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

/**
 * Lanes of work. A queue is a routing label, not a process: every worker of a
 * queue's class serves it unless told to serve named queues only, so adding
 * one costs nothing until a pool is sized for it. `cap` bounds how many of
 * its runs go at once across all workers; null leaves that to pool sizes.
 */
export const JOB_QUEUES = [
  {
    name: "index",
    class: "heavy",
    cap: 1,
    description: "Repository indexing: fetch, diff and embed code.",
  },
  {
    name: "embed",
    class: "heavy",
    cap: 1,
    description: "Embedding backfills over stored knowledge and code.",
  },
  {
    name: "testing",
    class: "heavy",
    cap: 1,
    description: "Load tests against a named target.",
  },
  {
    name: "sync",
    class: "light",
    cap: 2,
    description: "Pulls from source connections.",
  },
  {
    name: "maintenance",
    class: "light",
    cap: null,
    description: "Short housekeeping: sweeps, refreshes, gap finding.",
  },
] as const satisfies readonly JobQueue[];

export interface JobQueue {
  name: string;
  class: JobResourceClass;
  cap: number | null;
  description: string;
}

export const JOB_QUEUE_NAMES = JOB_QUEUES.map((q) => q.name);

export function jobQueue(name: string): JobQueue {
  const q = JOB_QUEUES.find((x) => x.name === name);
  if (!q) throw new Error(`unknown job queue '${name}'`);
  return q;
}

/**
 * Claim order within a queue, highest first. Someone waiting on a button beats
 * work a run fanned out, which beats a schedule; a run queued by another run
 * takes its parent's priority instead.
 */
export const JOB_PRIORITY: Record<JobTrigger, number> = {
  manual: 10,
  event: 5,
  schedule: 0,
};

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
export type JobQueueName = (typeof JOB_QUEUES)[number]["name"];

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
  /**
   * How long runs waited in each queue before a worker took them, over runs
   * that started in the window. Every queue is listed, in JOB_QUEUES order.
   */
  by_queue: {
    queue: JobQueueName;
    started: number;
    avg_wait_seconds: number | null;
    max_wait_seconds: number | null;
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
  /** Null on runs queued before queues existed; those are claimed by class. */
  queue: JobQueueName | null;
  priority: number;
  dedupe_key: string | null;
  /** The run that queued this one, for work a run fans out. */
  parent_id: string | null;
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

/** A run as the admin lists it, with the names its ids point at. */
export interface JobRunListed extends JobRun {
  definition_name: string | null;
  requested_by_name: string | null;
  /** How the runs this one queued are doing; null when it queued none. */
  children: {
    total: number;
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
  } | null;
}

export interface JobDefinition {
  id: string;
  kind: string;
  name: string;
  params: Record<string, unknown>;
  enabled: boolean;
  schedule: string | null;
  timezone: string;
  queue: JobQueueName | null;
  timeout: string | null;
  overlap: JobOverlap | null;
  notify: JobNotify;
  last_scheduled_for: string | null;
  disabled_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** A job worker process, as it last reported itself. */
export interface JobWorkerRow {
  id: string;
  host: string;
  pid: number;
  classes: JobResourceClass[];
  queues: JobQueueName[];
  concurrency: number;
  /** Slots per class within `concurrency`, where the process limits them. */
  per_class: Partial<Record<JobResourceClass, number>>;
  draining: boolean;
  started_at: string;
  last_seen_at: string;
  /** Seen within the last minute. A dead worker stays listed a while. */
  alive: boolean;
  runs: {
    id: string;
    kind: string;
    queue: JobQueueName | null;
    params: Record<string, unknown>;
    definition_name: string | null;
    progress: number | null;
    progress_note: string | null;
    started_at: string;
  }[];
}

/** What the workers page follows live. */
export interface JobLive {
  workers: JobWorkerRow[];
  queues: {
    name: JobQueueName;
    class: JobResourceClass;
    cap: number | null;
    queued: number;
    running: number;
    oldest_queued_at: string | null;
    /** Live workers that claim from this queue, and the slots they bring. */
    workers: number;
    slots: number;
  }[];
}
