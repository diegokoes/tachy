import {
  JOB_FINISHED,
  JOB_PRIORITY,
  JOB_QUEUES,
  jobQueue,
  parseDuration,
  type JobQueueName,
  type JobRun,
  type JobRunListed,
  type JobStatus,
  type JobTrigger,
} from "@tachy/contract";
import { sql, type Db, jsonb } from "../infra/db";
import { badInput, notFound } from "../infra/errors";
import { presentRun } from "./present";
import { getJobKind, type JobKind } from "./registry";

export type { JobRun, JobRunListed };

export const JOB_RUNS_CHANNEL = "job_runs";

/**
 * Inserts a run, and notifies workers once the transaction commits. Code that
 * changes data passes its own transaction, so the run exists exactly when the
 * change does. Returns null when overlap is `skip` and the definition already
 * has a run queued or going, or when the kind's dedupe key does
 * (`inFlightRun` finds that one).
 */
export async function enqueueRun(opts: {
  kind: string;
  params: unknown;
  trigger: JobTrigger;
  definitionId?: string | null;
  scheduledFor?: Date | null;
  requestedBy?: string | null;
  /** The run queueing this one. */
  parentId?: string | null;
  /** Defaults by trigger (JOB_PRIORITY). */
  priority?: number;
  db?: Db;
}): Promise<string | null> {
  const db = opts.db ?? sql;
  const kind = getJobKind(opts.kind);
  const parsed = kind.params.safeParse(opts.params);
  if (!parsed.success)
    throw badInput(
      `params for ${opts.kind}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );

  let queue: JobQueueName = kind.queue;
  let timeout = kind.timeout;
  let overlap = kind.overlap;
  if (opts.definitionId) {
    const [definition] = await db`
      select queue, timeout, overlap from job_definitions where id = ${opts.definitionId}
    `;
    if (!definition)
      throw notFound(`job definition ${opts.definitionId} not found`);
    queue = definition.queue ?? queue;
    timeout = definition.timeout ?? timeout;
    overlap = definition.overlap ?? overlap;
    if (overlap === "skip" && opts.trigger === "schedule") {
      const [busy] = await db`
        select 1 from job_runs
        where definition_id = ${opts.definitionId} and status in ('queued','running') limit 1
      `;
      if (busy) return null;
    }
  }

  const [row] = await db`
    insert into job_runs (definition_id, kind, params, resource_class, queue, priority,
                          dedupe_key, parent_id, trigger, scheduled_for, requested_by,
                          max_attempts, timeout_ms)
    values (${opts.definitionId ?? null}, ${opts.kind}, ${jsonb(parsed.data)},
            ${jobQueue(queue).class}, ${queue}, ${opts.priority ?? JOB_PRIORITY[opts.trigger]},
            ${dedupeKeyOf(kind, parsed.data)}, ${opts.parentId ?? null}, ${opts.trigger},
            ${opts.scheduledFor ?? null}, ${opts.requestedBy ?? null}, ${kind.maxAttempts},
            ${parseDuration(timeout)})
    on conflict do nothing
    returning id
  `;
  if (!row) return null;
  await db`select pg_notify(${JOB_RUNS_CHANNEL}, ${row.id})`;
  return row.id as string;
}

function dedupeKeyOf(kind: JobKind, params: unknown): string | null {
  return kind.dedupeKey ? `${kind.kind}:${kind.dedupeKey(params)}` : null;
}

/** The queued or running run holding the dedupe key these params make, if any. */
export async function inFlightRun(
  kindName: string,
  params: unknown,
): Promise<string | null> {
  const kind = getJobKind(kindName);
  const key = dedupeKeyOf(kind, kind.params.parse(params));
  if (!key) return null;
  const [row] = await sql`
    select id from job_runs
    where dedupe_key = ${key} and status in ('queued', 'running')
  `;
  return row ? (row.id as string) : null;
}

const RUN_COLUMNS = sql`id, definition_id, kind, params, resource_class, queue, priority,
  dedupe_key, parent_id, trigger, scheduled_for,
  requested_by, status, attempts, max_attempts, timeout_ms::float8 as timeout_ms, run_after,
  locked_by, locked_until, cancel_requested, progress, progress_note, output, error, log_tail,
  created_at, started_at, finished_at`;

const CLAIM_LOCK = 7_311_902_452;

/**
 * Takes the most urgent runnable run of the given classes, or null: highest
 * priority, then oldest. `queues` narrows a worker to those queues. A queue
 * already running its cap is passed over. Claims take turns under an advisory
 * lock so two workers cannot both see room under a cap and both fill it.
 */
export async function claimRun(
  classes: string[],
  workerId: string,
  leaseMs: number,
  queues?: string[],
): Promise<JobRun | null> {
  const capped = JOB_QUEUES.filter((q) => q.cap !== null);
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${CLAIM_LOCK})`;
    const [row] = await tx`
      update job_runs set
        status = 'running', attempts = attempts + 1, locked_by = ${workerId},
        locked_until = now() + ${leaseMs} * interval '1 millisecond',
        started_at = coalesce(started_at, now()), error = null
      where id = (
        select j.id from job_runs j
        where j.status = 'queued' and j.resource_class = any(${classes})
          and j.run_after <= now()
          and (${queues ?? null}::text[] is null or j.queue = any(${queues ?? null}::text[]))
          and (j.queue is null or j.queue <> all (
            select c.name
            from unnest(${capped.map((q) => q.name)}::text[], ${capped.map((q) => q.cap)}::int[]) as c(name, cap)
            where (select count(*) from job_runs r where r.status = 'running' and r.queue = c.name) >= c.cap
          ))
        order by j.priority desc, j.run_after, j.created_at
        for update skip locked
        limit 1
      )
      returning ${RUN_COLUMNS}
    `;
    return (row as never) ?? null;
  }) as Promise<JobRun | null>;
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

/**
 * Newest first. `active` keeps queued and running runs; `before` is the id
 * of the last run of the previous page.
 */
export async function listJobRuns(opts: {
  definitionId?: string;
  parentId?: string;
  status?: JobStatus;
  kind?: string;
  queue?: string;
  trigger?: JobTrigger;
  active?: boolean;
  before?: string;
  limit?: number;
}): Promise<JobRunListed[]> {
  const limit = Math.min(opts.limit ?? 50, 500);
  const rows = await sql`
    select r.*, d.name as definition_name,
           coalesce(u.display_name, u.email) as requested_by_name,
           p.kind as parent_kind, pd.name as parent_name,
           case when ch.total > 0 then json_build_object(
             'total', ch.total, 'queued', ch.queued, 'running', ch.running,
             'succeeded', ch.succeeded, 'failed', ch.failed) end as children
    from (
      select ${RUN_COLUMNS} from job_runs
      where (${opts.definitionId ?? null}::uuid is null or definition_id = ${opts.definitionId ?? null})
        and (${opts.parentId ?? null}::uuid is null or parent_id = ${opts.parentId ?? null})
        and (${opts.status ?? null}::text is null or status = ${opts.status ?? null})
        and (${opts.kind ?? null}::text is null or kind = ${opts.kind ?? null})
        and (${opts.queue ?? null}::text is null or queue = ${opts.queue ?? null})
        and (${opts.trigger ?? null}::text is null or trigger = ${opts.trigger ?? null})
        and (not ${opts.active ?? false} or status in ('queued', 'running'))
        and (${opts.before ?? null}::uuid is null
             or created_at < (select created_at from job_runs where id = ${opts.before ?? null}))
      order by created_at desc
      limit ${limit}
    ) r
    left join job_definitions d on d.id = r.definition_id
    left join users u on u.id = r.requested_by
    left join job_runs p on p.id = r.parent_id
    left join job_definitions pd on pd.id = p.definition_id
    left join lateral (
      select count(*)::int as total,
             count(*) filter (where c.status = 'queued')::int as queued,
             count(*) filter (where c.status = 'running')::int as running,
             count(*) filter (where c.status = 'succeeded')::int as succeeded,
             count(*) filter (where c.status in ('failed', 'timed_out'))::int as failed
      from job_runs c where c.parent_id = r.id
    ) ch on true
    order by r.created_at desc
  `;
  return rows.map((r) => ({
    ...r,
    ...presentRun(r.kind, r.params, r.output),
  })) as never;
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
