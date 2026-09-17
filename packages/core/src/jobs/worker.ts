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

export interface JobWorkerOptions {
  classes: string[];
  concurrency: number;
  workerId?: string;
  leaseMs?: number;
  pollMs?: number;
  scheduleMs?: number;
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

export async function startJobWorker(
  opts: JobWorkerOptions,
): Promise<JobWorker> {
  const workerId =
    opts.workerId ?? `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const leaseMs = opts.leaseMs ?? 60_000;
  const graceMs = opts.graceMs ?? 30_000;
  const running = new Map<string, Promise<void>>();
  let draining = false;
  let ticking = false;

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
    const beat = setInterval(
      async () => {
        try {
          const r = await heartbeatRun(run.id, workerId, leaseMs, {
            progress,
            note,
            logTail: tail.join("\n"),
          });
          if (r.cancelRequested) stop("cancelled");
          if (r.lost) stop("cancelled");
        } catch (err) {
          log("warn", "job_heartbeat_failed", {
            run: run.id,
            error: String(err),
          });
        }
      },
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
        signal: controller.signal,
        async progress(fraction: number, text?: string) {
          progress = Math.max(0, Math.min(1, fraction));
          if (text !== undefined) note = text;
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
        enqueue: async (k: string, p: unknown) =>
          (await enqueueRun({ kind: k, params: p, trigger: "event" })) ?? "",
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
        const run = await claimRun(opts.classes, workerId, leaseMs);
        if (!run) break;
        const p = execute(run).finally(() => running.delete(run.id));
        running.set(run.id, p);
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
  }, opts.scheduleMs ?? 30_000);
  void tick();
  log("info", "job_worker_started", {
    worker: workerId,
    classes: opts.classes,
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
      await listener.unlisten().catch(() => {});
      await Promise.race([
        Promise.allSettled([...running.values()]),
        new Promise((r) => setTimeout(r, waitMs)),
      ]);
    },
  };
}
