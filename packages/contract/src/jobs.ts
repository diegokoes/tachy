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
