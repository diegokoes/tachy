import { z } from "zod";
import {
  parseDuration,
  type JobMissed,
  type JobOverlap,
  type JobResourceClass,
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
  enqueue(kind: string, params: unknown): Promise<string>;
}

export interface JobKind<P extends z.ZodType = z.ZodType> {
  kind: string;
  title: string;
  description?: string;
  params: P;
  /** A source type whose connections the admin form offers as a picker. */
  connection?: string;
  defaultSchedule?: string;
  resourceClass: JobResourceClass;
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
  kind: Omit<
    JobKind<P>,
    "overlap" | "missed" | "maxAttempts" | "resourceClass"
  > &
    Partial<
      Pick<JobKind<P>, "overlap" | "missed" | "maxAttempts" | "resourceClass">
    >,
): JobKind<P> {
  parseDuration(kind.timeout);
  const full: JobKind<P> = {
    overlap: "skip",
    missed: "run-once",
    maxAttempts: 1,
    resourceClass: "light",
    ...kind,
  };
  kinds.set(full.kind, full as unknown as JobKind);
  return full;
}

export function getJobKind(kind: string): JobKind {
  const k = kinds.get(kind);
  if (!k) throw new Error(`unknown job kind '${kind}'`);
  return k;
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
      resource_class: k.resourceClass,
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
