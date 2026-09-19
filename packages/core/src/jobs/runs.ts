import {
  JOB_FINISHED,
  parseDuration,
  type JobRun,
  type JobStatus,
  type JobTrigger,
} from "@tachy/contract";
import { sql, type Db, jsonb } from "../infra/db";
import { badInput, notFound } from "../infra/errors";
import { getJobKind } from "./registry";

export type { JobRun };

export const JOB_RUNS_CHANNEL = "job_runs";

/**
 * Inserts a run, and notifies workers once the transaction commits. Code that
 * changes data passes its own transaction, so the run exists exactly when the
 * change does. Returns null when overlap is `skip` and the definition already
 * has a run queued or going.
 */
export async function enqueueRun(opts: {
  kind: string;
  params: unknown;
  trigger: JobTrigger;
  definitionId?: string | null;
  scheduledFor?: Date | null;
  requestedBy?: string | null;
  db?: Db;
}): Promise<string | null> {
  const db = opts.db ?? sql;
  const kind = getJobKind(opts.kind);
  const parsed = kind.params.safeParse(opts.params);
  if (!parsed.success)
    throw badInput(
      `params for ${opts.kind}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );

  let resourceClass = kind.resourceClass;
  let timeout = kind.timeout;
  let overlap = kind.overlap;
  if (opts.definitionId) {
    const [d] = await db`
      select resource_class, timeout, overlap from job_definitions where id = ${opts.definitionId}
    `;
    if (!d) throw notFound(`job definition ${opts.definitionId} not found`);
    resourceClass = d.resource_class ?? resourceClass;
    timeout = d.timeout ?? timeout;
    overlap = d.overlap ?? overlap;
    if (overlap === "skip" && opts.trigger === "schedule") {
      const [busy] = await db`
        select 1 from job_runs
        where definition_id = ${opts.definitionId} and status in ('queued','running') limit 1
      `;
      if (busy) return null;
    }
  }

  const [row] = await db`
    insert into job_runs (definition_id, kind, params, resource_class, trigger, scheduled_for,
                          requested_by, max_attempts, timeout_ms)
    values (${opts.definitionId ?? null}, ${opts.kind}, ${jsonb(parsed.data)},
            ${resourceClass}, ${opts.trigger}, ${opts.scheduledFor ?? null},
            ${opts.requestedBy ?? null}, ${kind.maxAttempts}, ${parseDuration(timeout)})
    on conflict (definition_id, scheduled_for) do nothing
    returning id
  `;
  if (!row) return null;
  await db`select pg_notify(${JOB_RUNS_CHANNEL}, ${row.id})`;
  return row.id as string;
}

const RUN_COLUMNS = sql`id, definition_id, kind, params, resource_class, trigger, scheduled_for,
  requested_by, status, attempts, max_attempts, timeout_ms::float8 as timeout_ms, run_after,
  locked_by, locked_until, cancel_requested, progress, progress_note, output, error, log_tail,
  created_at, started_at, finished_at`;

/** Takes the oldest runnable run of the given classes, or null. */
export async function claimRun(
  classes: string[],
  workerId: string,
  leaseMs: number,
): Promise<JobRun | null> {
  const [row] = await sql`
    update job_runs set
      status = 'running', attempts = attempts + 1, locked_by = ${workerId},
      locked_until = now() + ${leaseMs} * interval '1 millisecond',
      started_at = coalesce(started_at, now()), error = null
    where id = (
      select id from job_runs
      where status = 'queued' and resource_class = any(${classes}) and run_after <= now()
      order by run_after, created_at
      for update skip locked
      limit 1
    )
    returning ${RUN_COLUMNS}
  `;
  return (row as never) ?? null;
}

/** Extends the lease; answers whether someone asked for the run to stop. */
export async function heartbeatRun(
  runId: string,
  workerId: string,
  leaseMs: number,
  state: { progress?: number | null; note?: string | null; logTail?: string },
): Promise<{ cancelRequested: boolean; lost: boolean }> {
  const [row] = await sql`
    update job_runs set
      locked_until = now() + ${leaseMs} * interval '1 millisecond',
      progress = coalesce(${state.progress ?? null}, progress),
      progress_note = coalesce(${state.note ?? null}, progress_note),
      log_tail = coalesce(${state.logTail ?? null}, log_tail)
    where id = ${runId} and locked_by = ${workerId} and status = 'running'
    returning cancel_requested
  `;
  return row
    ? { cancelRequested: row.cancel_requested as boolean, lost: false }
    : { cancelRequested: false, lost: true };
}

/**
 * Records how a run ended. A failure with attempts left goes back to the queue
 * after an exponential backoff instead.
 */
export async function finishRun(
  runId: string,
  workerId: string,
  outcome: {
    status: "succeeded" | "failed" | "cancelled" | "timed_out";
    output?: Record<string, unknown> | null;
    error?: string | null;
    logTail: string;
  },
): Promise<JobRun | null> {
  const [row] = await sql`
    update job_runs set
      status = case
        when ${outcome.status} = 'failed' and attempts < max_attempts then 'queued'
        else ${outcome.status} end,
      run_after = case
        when ${outcome.status} = 'failed' and attempts < max_attempts
        then now() + power(2, attempts - 1) * interval '30 seconds'
        else run_after end,
      finished_at = case
        when ${outcome.status} = 'failed' and attempts < max_attempts then null
        else now() end,
      locked_by = null, locked_until = null,
      output = ${outcome.output ? jsonb(outcome.output) : null},
      error = ${outcome.error ?? null},
      log_tail = ${outcome.logTail},
      progress = case when ${outcome.status} = 'succeeded' then 1 else progress end
    where id = ${runId} and locked_by = ${workerId}
    returning ${RUN_COLUMNS}
  `;
  return (row as never) ?? null;
}

/** A queued run is cancelled outright; a running one is asked to stop. */
export async function cancelRun(runId: string): Promise<JobRun> {
  const [row] = await sql`
    update job_runs set
      status = case when status = 'queued' then 'cancelled' else status end,
      finished_at = case when status = 'queued' then now() else finished_at end,
      cancel_requested = case when status = 'running' then true else cancel_requested end
    where id = ${runId}
    returning ${RUN_COLUMNS}
  `;
  if (!row) throw notFound(`job run ${runId} not found`);
  return row as never;
}

/** Runs whose worker stopped heartbeating: requeued, or failed if out of attempts. */
export async function reapExpiredRuns(): Promise<number> {
  const rows = await sql`
    update job_runs set
      status = case when attempts < max_attempts then 'queued' else 'failed' end,
      finished_at = case when attempts < max_attempts then null else now() end,
      error = 'the worker stopped heartbeating (it restarted or died)',
      locked_by = null, locked_until = null
    where status = 'running' and locked_until < now()
    returning id
  `;
  return rows.length;
}

export async function getJobRun(id: string): Promise<JobRun> {
  const [row] = await sql`select ${RUN_COLUMNS} from job_runs where id = ${id}`;
  if (!row) throw notFound(`job run ${id} not found`);
  return row as never;
}

export async function listJobRuns(opts: {
  definitionId?: string;
  status?: JobStatus;
  limit?: number;
}): Promise<JobRun[]> {
  const limit = Math.min(opts.limit ?? 50, 500);
  return (await sql`
    select ${RUN_COLUMNS} from job_runs
    where (${opts.definitionId ?? null}::uuid is null or definition_id = ${opts.definitionId ?? null})
      and (${opts.status ?? null}::text is null or status = ${opts.status ?? null})
    order by created_at desc
    limit ${limit}
  `) as never;
}

/** Runs keep 90 days, failed ones 180. */
export async function sweepJobRuns(): Promise<number> {
  const rows = await sql`
    delete from job_runs
    where status = any(${[...JOB_FINISHED]})
      and finished_at < now() - case when status = 'failed' then interval '180 days' else interval '90 days' end
    returning id
  `;
  return rows.length;
}

/** Heavy runs going now: each holds chat slots while it runs. */
export async function runningHeavyJobs(): Promise<number> {
  const [row] = await sql`
    select count(*)::int as n from job_runs where status = 'running' and resource_class = 'heavy'
  `;
  return row.n as number;
}
