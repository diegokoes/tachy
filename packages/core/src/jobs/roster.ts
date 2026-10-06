import {
  JOB_QUEUES,
  type JobLive,
  type JobResourceClass,
  type JobWorkerRow,
} from "@tachy/contract";
import { sql, jsonb } from "../infra/db";
import { kindTitle, presentRun } from "./present";

export type { JobLive, JobWorkerRow };

/** A worker unseen for this long is presumed dead. It beats every 15 s. */
const ALIVE_MS = 60_000;
/** How long a dead worker stays listed, so its going is seen rather than silent. */
const FORGET_MS = 15 * 60_000;

export interface WorkerCard {
  id: string;
  host: string;
  pid: number;
  classes: string[];
  queues?: string[];
  concurrency: number;
  perClass?: Partial<Record<string, number>>;
}

/** The queues a worker claims from: those it names, else all of its classes'. */
export function servedQueues(classes: string[], queues?: string[]): string[] {
  return (
    queues ??
    JOB_QUEUES.filter((q) => classes.includes(q.class)).map((q) => q.name)
  );
}

/** Registers the worker, or refreshes it; a row the reaper dropped comes back. */
export async function beatWorker(card: WorkerCard): Promise<void> {
  await sql`
    insert into job_workers (id, host, pid, classes, queues, concurrency, per_class)
    values (${card.id}, ${card.host}, ${card.pid}, ${card.classes},
            ${servedQueues(card.classes, card.queues)}, ${card.concurrency},
            ${jsonb(card.perClass ?? {})})
    on conflict (id) do update set last_seen_at = now()
  `;
}

export async function markWorkerDraining(id: string): Promise<void> {
  await sql`update job_workers set draining = true, last_seen_at = now() where id = ${id}`;
}

export async function retireWorker(id: string): Promise<void> {
  await sql`delete from job_workers where id = ${id}`;
}

export async function pruneWorkers(): Promise<number> {
  const rows = await sql`
    delete from job_workers
    where last_seen_at < now() - ${FORGET_MS} * interval '1 millisecond'
    returning id
  `;
  return rows.length;
}

/**
 * What the workers page follows while it is open: each worker with the runs
 * it holds, and each queue's backlog against the live workers serving it.
 */
export async function jobLive(): Promise<JobLive> {
  const workers = await sql`
    select w.id, w.host, w.pid, w.classes, w.queues, w.concurrency, w.per_class,
           w.draining, w.started_at, w.last_seen_at,
           w.last_seen_at > now() - ${ALIVE_MS} * interval '1 millisecond' as alive,
           coalesce(
             json_agg(json_build_object(
               'id', r.id, 'kind', r.kind, 'queue', r.queue, 'params', r.params,
               'definition_name', d.name, 'progress', r.progress,
               'progress_note', r.progress_note, 'started_at', r.started_at
             ) order by r.started_at) filter (where r.id is not null),
             '[]'
           ) as runs
    from job_workers w
    left join job_runs r on r.locked_by = w.id and r.status = 'running'
    left join job_definitions d on d.id = r.definition_id
    group by w.id
    order by w.started_at
  `;
  const counts = await sql`
    select coalesce(queue, resource_class) as lane, status, count(*)::int as n,
           min(run_after) filter (where status = 'queued') as oldest
    from job_runs
    where status in ('queued', 'running')
    group by 1, 2
  `;
  const alive = workers.filter((w) => w.alive && !w.draining);
  const queues = JOB_QUEUES.map((q) => {
    const of = (status: string) =>
      counts.find((c) => c.lane === q.name && c.status === status);
    const serving = alive.filter((w) =>
      (w.queues as string[]).includes(q.name),
    );
    return {
      name: q.name,
      class: q.class as JobResourceClass,
      cap: q.cap,
      queued: of("queued")?.n ?? 0,
      running: of("running")?.n ?? 0,
      oldest_queued_at: of("queued")?.oldest
        ? new Date(of("queued")!.oldest).toISOString()
        : null,
      workers: serving.length,
      slots: serving.reduce(
        (n, w) =>
          n +
          Math.min(
            w.concurrency as number,
            (w.per_class as Record<string, number>)[q.class] ?? Infinity,
          ),
        0,
      ),
    };
  });
  return {
    workers: workers.map((w) => ({
      ...w,
      runs: (w.runs as { kind: string; params: Record<string, unknown> }[]).map(
        (r) => ({
          ...r,
          kind_title: kindTitle(r.kind),
          subject: presentRun(r.kind, r.params, null).subject,
        }),
      ),
    })) as never,
    queues,
  };
}

/** Queues with runs due and no live worker to claim them. */
export async function unservedQueues(): Promise<
  { queue: string; queued: number }[]
> {
  const live = await jobLive();
  return live.queues
    .filter((q) => q.queued > 0 && q.workers === 0)
    .map((q) => ({ queue: q.name, queued: q.queued }));
}
