import { Cron } from "croner";
import {
  JOB_FINISHED,
  JOB_RESOURCE_CLASSES,
  JOB_STATUSES,
  JOB_TRIGGERS,
  type JobResourceClass,
  type JobStatus,
  type JobTrigger,
} from "@tachy/contract";
import { sql } from "../infra/db";
import { ISSUE_ITEMS, issueList, type IssueList } from "../infra/issues";
import type { JobCensus } from "@tachy/contract";

export type { JobCensus };

const zeroes = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

const FAILED: JobStatus[] = ["failed", "timed_out"];

/** What the job workers have been doing over the last `days` days. */
export async function jobCensus(
  days = 14,
  now = new Date(),
): Promise<JobCensus> {
  const window = sql`created_at > now() - make_interval(days => ${days})`;
  const grouped = await sql`
    select status, trigger, resource_class, count(*)::int as n
    from job_runs where ${window}
    group by status, trigger, resource_class
  `;
  const by_status = zeroes(JOB_STATUSES);
  const by_trigger = zeroes(JOB_TRIGGERS);
  const by_class = zeroes(JOB_RESOURCE_CLASSES);
  const success = Object.fromEntries(
    JOB_RESOURCE_CLASSES.map((c) => [c, { finished: 0, succeeded: 0 }]),
  ) as JobCensus["success"];
  let runs = 0;
  for (const r of grouped) {
    const n = r.n as number;
    runs += n;
    by_status[r.status as JobStatus] += n;
    by_trigger[r.trigger as JobTrigger] += n;
    by_class[r.resource_class as JobResourceClass] += n;
    const pool = success[r.resource_class as JobResourceClass];
    if (r.status === "succeeded" || FAILED.includes(r.status)) {
      pool.finished += n;
      if (r.status === "succeeded") pool.succeeded += n;
    }
  }

  const perDayWindow = Math.min(days, 14);
  const daily = await sql`
    select to_char(d.day, 'YYYY-MM-DD') as day, r.status, count(r.id)::int as n
    from generate_series(current_date - ${perDayWindow - 1}::int, current_date, interval '1 day') as d(day)
    left join job_runs r on r.created_at::date = d.day::date
    group by d.day, r.status
    order by d.day
  `;
  const days_ = new Map<string, { day: string } & Record<JobStatus, number>>();
  for (const r of daily) {
    const row = days_.get(r.day) ?? {
      day: r.day as string,
      ...zeroes(JOB_STATUSES),
    };
    if (r.status) row[r.status as JobStatus] += r.n as number;
    days_.set(r.day, row);
  }

  const by_kind = await sql`
    select kind, count(*)::int as runs,
      count(*) filter (where status = 'succeeded')::int as succeeded,
      count(*) filter (where status = any(${FAILED}))::int as failed,
      (avg(extract(epoch from finished_at - started_at))
        filter (where started_at is not null and finished_at is not null))::float8 as avg_seconds
    from job_runs where ${window}
    group by kind
    order by 2 desc, 1
  `;

  const live = await sql`
    select resource_class, status, count(*)::int as n
    from job_runs where status in ('running', 'queued')
    group by resource_class, status
  `;
  const current = Object.fromEntries(
    JOB_RESOURCE_CLASSES.map((c) => [c, { running: 0, queued: 0 }]),
  ) as JobCensus["now"];
  for (const r of live)
    current[r.resource_class as JobResourceClass][
      r.status as "running" | "queued"
    ] = r.n as number;

  const [definitions] = await sql`
    select count(*)::int as total,
      count(*) filter (where enabled)::int as enabled,
      count(*) filter (where enabled and schedule is not null)::int as scheduled,
      count(*) filter (where enabled and schedule is null)::int as manual,
      count(*) filter (where not enabled)::int as disabled
    from job_definitions
  `;

  const scheduled = await sql`
    select id, name, kind, schedule, timezone from job_definitions
    where enabled and schedule is not null
    order by name
  `;
  const horizon = now.getTime() + 86_400_000;
  const upcoming = scheduled.flatMap((d) => {
    const at: string[] = [];
    try {
      const cron = new Cron(d.schedule, { timezone: d.timezone });
      for (
        let t = cron.nextRun(now);
        t && t.getTime() <= horizon && at.length < 96;
        t = cron.nextRun(t)
      )
        at.push(t.toISOString());
    } catch {
      return [];
    }
    return at.length ? [{ id: d.id, name: d.name, kind: d.kind, at }] : [];
  });

  return {
    days,
    runs,
    by_status,
    by_trigger,
    by_class,
    per_day: [...days_.values()],
    by_kind: [...by_kind] as unknown as JobCensus["by_kind"],
    success,
    now: current,
    definitions: definitions as JobCensus["definitions"],
    upcoming,
  };
}

/** Definitions that need a hand, for the admin issues list. */
export async function jobIssues(): Promise<Record<string, IssueList>> {
  const failing = await sql`
    select d.id as key, d.name as label, count(*) over () as total
    from job_definitions d
    join lateral (
      select status from job_runs r
      where r.definition_id = d.id and r.status = any(${[...JOB_FINISHED]})
      order by r.created_at desc limit 1
    ) last on true
    where last.status = any(${FAILED})
    order by d.name limit ${ISSUE_ITEMS}
  `;
  const disabled = await sql`
    select id as key, name as label, count(*) over () as total
    from job_definitions where disabled_reason is not null
    order by name limit ${ISSUE_ITEMS}
  `;
  const stuck = await sql`
    select r.id as key, coalesce(d.name, r.kind) as label, count(*) over () as total
    from job_runs r
    left join job_definitions d on d.id = r.definition_id
    where r.status = 'queued' and r.run_after < now() - interval '15 minutes'
    order by r.created_at limit ${ISSUE_ITEMS}
  `;
  return {
    "jobs.failing": issueList(failing),
    "jobs.disabled": issueList(disabled),
    "jobs.stuck": issueList(stuck),
  };
}
