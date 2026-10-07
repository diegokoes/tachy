import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { TokenMap, scrubText } from "../compliance/redaction";
import { resolveCredential } from "../config/credentials";
import { sql } from "../infra/db";
import { log } from "../infra/log";
import { disableInvalidDefinitions } from "./definitions";
import { getJobKind, hasJobKind } from "./registry";
import {
  JOB_RUNS_CHANNEL,
  claimRun,
  enqueueRun,
  finishRun,
  heartbeatRun,
  reapExpiredRuns,
  type JobRun,
} from "./runs";
import { scheduleDueRuns } from "./scheduler";
import {
  beatWorker,
  markWorkerDraining,
  pruneWorkers,
  retireWorker,
  type WorkerCard,
} from "./roster";

export interface JobWorkerOptions {
  classes: string[];
  /** Serve only these queues of those classes; every queue of them when absent. */
  queues?: string[];
  concurrency: number;
  /**
   * Slots per class within `concurrency`, for a process serving several
   * classes, so a long heavy run cannot hold every slot light runs need.
   */
  perClass?: Partial<Record<string, number>>;
  workerId?: string;
  leaseMs?: number;
  pollMs?: number;
  scheduleMs?: number;
  /** How often the worker reports itself alive in job_workers. */
  beatMs?: number;
  /** How long a cancelled or timed-out run gets to notice its signal. */
  graceMs?: number;
  /** Called with a run that ended for good, e.g. to notify Teams. */
  onFinished?: (run: JobRun) => Promise<void> | void;
  /** A run ignored its signal past the grace period; the process should restart. */
  onStuck?: (run: JobRun) => void;
}

export interface JobWorker {
  readonly active: number;
  /** Stops claiming, waits for running runs up to `waitMs`, then returns. */
  drain(waitMs: number): Promise<void>;
}

const TAIL_LINES = 200;
/**
 * How stale a run's progress may get in the admin view before a heartbeat is
 * brought forward.
 */
const PROGRESS_FLUSH_MS = 2_000;

export async function startJobWorker(
  opts: JobWorkerOptions,
): Promise<JobWorker> {
  const workerId =
    opts.workerId ?? `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const leaseMs = opts.leaseMs ?? 60_000;
  const graceMs = opts.graceMs ?? 30_000;
  const running = new Map<string, { cls: string; done: Promise<void> }>();
  let draining = false;
  let ticking = false;

  const card: WorkerCard = {
    id: workerId,
    host: hostname(),
    pid: process.pid,
    classes: opts.classes,
    queues: opts.queues,
    concurrency: opts.concurrency,
    perClass: opts.perClass,
  };
  const report = () =>
    beatWorker(card).catch((err) =>
      log("warn", "job_worker_beat_failed", { error: String(err) }),
    );
  await report();

  const disabled = await disableInvalidDefinitions();
  if (disabled.length)
    log("warn", "job_definitions_disabled", { names: disabled });

  const execute = async (run: JobRun) => {
    const controller = new AbortController();
    const tail: string[] = [];
    const redact = new TokenMap();
    let progress: number | null = null;
    let note: string | null = null;
    let why: "cancelled" | "timed_out" | null = null;
    const push = (line: string) => {
      tail.push(scrubText(line, redact));
      if (tail.length > TAIL_LINES) tail.shift();
    };

    const stop = (reason: "cancelled" | "timed_out") => {
      if (why) return;
      why = reason;
      controller.abort(new Error(reason));
    };
    let beatAt = 0;
    const heartbeat = async () => {
      beatAt = Date.now();
      try {
        const beat = await heartbeatRun(run.id, workerId, leaseMs, {
          progress,
          note,
          logTail: tail.join("\n"),
        });
        if (beat.cancelRequested) stop("cancelled");
        if (beat.lost) stop("cancelled");
      } catch (err) {
        log("warn", "job_heartbeat_failed", {
          run: run.id,
          error: String(err),
        });
      }
    };
    const beat = setInterval(
      () => void heartbeat(),
      Math.max(1_000, Math.floor(leaseMs / 3)),
    );
    const timer = setTimeout(() => stop("timed_out"), run.timeout_ms);

    let outcome: Parameters<typeof finishRun>[2];
    try {
      if (!hasJobKind(run.kind))
        throw new Error(`unknown job kind '${run.kind}'`);
      const kind = getJobKind(run.kind);
      const params = kind.params.parse(run.params);
      const ctx = {
        runId: run.id,
        requestedBy: run.requested_by,
        signal: controller.signal,
        async progress(fraction: number, text?: string) {
          progress = Math.max(0, Math.min(1, fraction));
          if (text !== undefined) note = text;
          if (Date.now() - beatAt >= PROGRESS_FLUSH_MS) void heartbeat();
        },
        log(message: string, fields: Record<string, unknown> = {}) {
          log("info", "job_log", {
            run: run.id,
            kind: run.kind,
            message,
            ...fields,
          });
          push(
            `${new Date().toISOString()} ${message}${Object.keys(fields).length ? " " + JSON.stringify(fields) : ""}`,
          );
        },
        credential: (name: string) => resolveCredential(name, {}),
        enqueue: (k: string, p: unknown) =>
          enqueueRun({
            kind: k,
            params: p,
            trigger: "event",
            parentId: run.id,
            priority: run.priority,
          }),
      };
      const work = kind.run(ctx, params);
      const aborted = new Promise<never>((_, reject) =>
        controller.signal.addEventListener("abort", () =>
          setTimeout(() => reject(new Error("stuck")), graceMs).unref(),
        ),
      );
      const output = await Promise.race([work, aborted]);
      outcome = why
        ? {
            status: why,
            error: why === "timed_out" ? "timed out" : "cancelled",
            logTail: tail.join("\n"),
          }
        : {
            status: "succeeded",
            output: output ?? null,
            logTail: tail.join("\n"),
          };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "stuck") {
        opts.onStuck?.(run);
        log("error", "job_stuck", { run: run.id, kind: run.kind });
      }
      push(`error: ${message}`);
      outcome = why
        ? {
            status: why,
            error: why === "timed_out" ? "timed out" : "cancelled",
            logTail: tail.join("\n"),
          }
        : {
            status: "failed",
            error: scrubText(message, redact),
            logTail: tail.join("\n"),
          };
    } finally {
      clearInterval(beat);
      clearTimeout(timer);
    }
    const finished = await finishRun(run.id, workerId, outcome).catch((err) => {
      log("error", "job_finish_failed", { run: run.id, error: String(err) });
      return null;
    });
    log(outcome.status === "succeeded" ? "info" : "warn", "job_run", {
      run: run.id,
      kind: run.kind,
      status: finished?.status ?? outcome.status,
      attempt: run.attempts,
    });
    if (finished && finished.status !== "queued")
      await opts.onFinished?.(finished);
  };

  const tick = async () => {
    if (ticking || draining) return;
    ticking = true;
    try {
      while (!draining && running.size < opts.concurrency) {
        const room = opts.classes.filter(
          (c) =>
            [...running.values()].filter((r) => r.cls === c).length <
            (opts.perClass?.[c] ?? Infinity),
        );
        if (!room.length) break;
        const run = await claimRun(room, workerId, leaseMs, opts.queues);
        if (!run) break;
        const done = execute(run).finally(() => running.delete(run.id));
        running.set(run.id, { cls: run.resource_class, done });
      }
    } catch (err) {
      log("error", "job_claim_failed", { error: String(err) });
    } finally {
      ticking = false;
    }
  };

  const listener = await sql.listen(JOB_RUNS_CHANNEL, () => void tick());
  const poll = setInterval(() => void tick(), opts.pollMs ?? 10_000);
  const schedule = setInterval(() => {
    scheduleDueRuns()
      .then((n) => (n ? tick() : undefined))
      .catch((err) =>
        log("error", "job_schedule_failed", { error: String(err) }),
      );
    reapExpiredRuns()
      .then((n) => n && log("warn", "job_runs_reaped", { count: n }))
      .catch((err) => log("error", "job_reap_failed", { error: String(err) }));
    pruneWorkers().catch((err) =>
      log("error", "job_workers_prune_failed", { error: String(err) }),
    );
  }, opts.scheduleMs ?? 30_000);
  const alive = setInterval(() => void report(), opts.beatMs ?? 15_000);
  void tick();
  log("info", "job_worker_started", {
    worker: workerId,
    classes: opts.classes,
    queues: opts.queues ?? "all",
    concurrency: opts.concurrency,
  });

  return {
    get active() {
      return running.size;
    },
    async drain(waitMs: number) {
      draining = true;
      clearInterval(poll);
      clearInterval(schedule);
      clearInterval(alive);
      await markWorkerDraining(workerId).catch(() => {});
      await listener.unlisten().catch(() => {});
      await Promise.race([
        Promise.allSettled([...running.values()].map((r) => r.done)),
        new Promise((r) => setTimeout(r, waitMs)),
      ]);
      await retireWorker(workerId).catch(() => {});
    },
  };
}
