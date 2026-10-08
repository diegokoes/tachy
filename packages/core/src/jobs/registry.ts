import { z } from "zod";
import { badInput } from "../infra/errors";
import {
  jobQueue,
  parseDuration,
  type JobMissed,
  type JobOverlap,
  type JobQueueName,
} from "@tachy/contract";

export interface JobContext {
  runId: string;
  /** The user who started a manual run, whose credentials it may use. */
  requestedBy: string | null;
  /** Aborted when the run is cancelled or times out. Check it between steps. */
  signal: AbortSignal;
  progress(fraction: number, note?: string): Promise<void>;
  /** Goes to the container log with the run id, and to the run's log tail. */
  log(message: string, fields?: Record<string, unknown>): void;
  credential(name: string): Promise<string | undefined>;
  /**
   * Queues a run as this run's child, at this run's priority. Null when the
   * kind's dedupe key already has a run queued or going.
   */
  enqueue(kind: string, params: unknown): Promise<string | null>;
}

export interface JobKind<P extends z.ZodType = z.ZodType> {
  kind: string;
  title: string;
  description?: string;
  params: P;
  /** A source type whose connections the admin form offers as a picker. */
  connection?: string;
  defaultSchedule?: string;
  queue: JobQueueName;
  /**
   * Runs sharing a key never overlap: queueing one while another is queued or
   * going hands back the existing run instead.
   */
  dedupeKey?: (params: z.infer<P>) => string;
  /** What a run is about, shown under the job's name: a repo, a connection. */
  subject?: (params: z.infer<P>) => string | null;
  /** How a finished run went, in a line, from what `run` returned. */
  outcome?: (output: Record<string, unknown>) => string | null;
  overlap: JobOverlap;
  missed: JobMissed;
  timeout: string;
  maxAttempts: number;
  run(
    ctx: JobContext,
    params: z.infer<P>,
  ): Promise<Record<string, unknown> | void>;
}

const kinds = new Map<string, JobKind>();

/**
 * New behaviour arrives as a kind in a pull request; admins then enable,
 * schedule and parameterise it. The UI never uploads or runs code.
 */
export function defineJob<P extends z.ZodType>(
  kind: Omit<JobKind<P>, "overlap" | "missed" | "maxAttempts" | "queue"> &
    Partial<Pick<JobKind<P>, "overlap" | "missed" | "maxAttempts" | "queue">>,
): JobKind<P> {
  parseDuration(kind.timeout);
  const full: JobKind<P> = {
    overlap: "skip",
    missed: "run-once",
    maxAttempts: 1,
    queue: "maintenance",
    ...kind,
  };
  jobQueue(full.queue);
  kinds.set(full.kind, full as unknown as JobKind);
  return full;
}

export function getJobKind(kind: string): JobKind {
  const known = kinds.get(kind);
  if (!known) throw badInput(`unknown job kind '${kind}'`);
  return known;
}

export const hasJobKind = (kind: string) => kinds.has(kind);

/** What the SPA needs to render a definition form, with no code in it. */
export function describeJobKinds() {
  return [...kinds.values()]
    .sort((a, b) => a.kind.localeCompare(b.kind))
    .map((k) => ({
      kind: k.kind,
      title: k.title,
      description: k.description ?? null,
      connection: k.connection ?? null,
      default_schedule: k.defaultSchedule ?? null,
      queue: k.queue,
      resource_class: jobQueue(k.queue).class,
      overlap: k.overlap,
      missed: k.missed,
      timeout: k.timeout,
      max_attempts: k.maxAttempts,
      params_schema: z.toJSONSchema(k.params, { io: "input" }),
    }));
}

export function clearJobKinds(): void {
  kinds.clear();
}
