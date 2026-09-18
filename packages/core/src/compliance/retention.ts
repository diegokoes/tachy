import { readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { sweepExpiredOutputs } from "../exports/outputs";
import { sql } from "../infra/db";
import { sweepUploads } from "../infra/uploads";
import { defineJob } from "../jobs/registry";
import { sweepJobRuns } from "../jobs/runs";

const DAY = 86_400_000;

/**
 * Claude Code session files: every prompt, tool call and tool result of a chat,
 * customer text included. Removed a set time after they were last written; the
 * chat's record and counts in analysis_runs stay.
 */
export async function sweepTranscripts(
  days: number,
  now = Date.now(),
): Promise<number> {
  const root = join(
    process.env.TACHY_AGENT_HOME || join(homedir(), ".claude"),
    "users",
  );
  let removed = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(
      () => [],
    )) {
      const path = join(dir, e.name);
      if (e.isDirectory()) await walk(path);
      else if (e.isFile() && e.name.endsWith(".jsonl")) {
        const { mtimeMs } = await stat(path);
        if (now - mtimeMs > days * DAY) {
          await rm(path, { force: true });
          removed++;
        }
      }
    }
  };
  for (const user of await readdir(root, { withFileTypes: true }).catch(
    () => [],
  ))
    if (user.isDirectory()) await walk(join(root, user.name, "projects"));
  return removed;
}

/**
 * Per-person, per-day usage rows older than `months` become one row per item or
 * tool per month, with no person: enough to compare a month with the same month
 * a year earlier, without keeping who read what forever.
 */
export async function rollUpUsage(
  months: number,
): Promise<{ views: number; toolCalls: number }> {
  return sql.begin(async (tx) => {
    const cutoff = tx`date_trunc('month', current_date - make_interval(months => ${months}))::date`;
    const views = await tx`
      with old as (
        delete from library_views
        where day < ${cutoff}
          and not (user_id is null and day = date_trunc('month', day)::date)
        returning knowledge_entry_id, reference_doc_id, day, views, last_viewed_at
      ), grouped as (
        select knowledge_entry_id, reference_doc_id, date_trunc('month', day)::date as month,
               sum(views)::int as views, max(last_viewed_at) as last_viewed_at
        from old group by 1, 2, 3
      ), entries as (
        insert into library_views (knowledge_entry_id, user_id, day, views, last_viewed_at)
        select knowledge_entry_id, null, month, views, last_viewed_at from grouped
        where knowledge_entry_id is not null
        on conflict (knowledge_entry_id, user_id, day) where knowledge_entry_id is not null
        do update set views = library_views.views + excluded.views
        returning 1
      ), docs as (
        insert into library_views (reference_doc_id, user_id, day, views, last_viewed_at)
        select reference_doc_id, null, month, views, last_viewed_at from grouped
        where reference_doc_id is not null
        on conflict (reference_doc_id, user_id, day) where reference_doc_id is not null
        do update set views = library_views.views + excluded.views
        returning 1
      )
      select (select count(*) from old)::int as n
    `;
    const tools = await tx`
      with old as (
        delete from mcp_tool_calls
        where day < ${cutoff}
          and not (user_id is null and day = date_trunc('month', day)::date)
        returning tool, writes, day, calls, failures, misuse
      ), ins as (
        insert into mcp_tool_calls (tool, writes, user_id, day, calls, failures, misuse)
        select tool, bool_or(writes), null, date_trunc('month', day)::date,
               sum(calls)::int, sum(failures)::int, sum(misuse)::int
        from old group by tool, date_trunc('month', day)
        on conflict (tool, user_id, day) do update set
          calls = mcp_tool_calls.calls + excluded.calls,
          failures = mcp_tool_calls.failures + excluded.failures,
          misuse = mcp_tool_calls.misuse + excluded.misuse
        returning 1
      )
      select (select count(*) from old)::int as n
    `;
    return { views: views[0].n as number, toolCalls: tools[0].n as number };
  }) as Promise<{ views: number; toolCalls: number }>;
}

/** Images no body or revision mentions any more, a week after upload. */
export async function sweepOrphanAssets(): Promise<number> {
  const rows = await sql`
    delete from library_assets a
    where a.created_at < now() - interval '7 days'
      and not exists (select 1 from reference_docs d where d::text like '%' || a.id::text || '%')
      and not exists (select 1 from knowledge_entries k where k::text like '%' || a.id::text || '%')
      and not exists (select 1 from library_revisions r where r::text like '%' || a.id::text || '%')
    returning a.id
  `;
  return rows.length;
}

export function defineRetentionJobs() {
  defineJob({
    kind: "retention.sweep",
    title: "Apply retention",
    description:
      "Deletes expired exports and uploads, old job runs, Claude transcripts past their age, orphaned wiki images, and rolls old usage counters up to months without people.",
    params: z.object({
      transcript_days: z.number().int().min(1).default(90),
      usage_months: z.number().int().min(1).default(13),
    }),
    defaultSchedule: "30 3 * * *",
    timeout: "1h",
    run: async (ctx, p) => {
      const out = {
        outputs: await sweepExpiredOutputs(),
        uploads: await sweepUploads(),
        job_runs: await sweepJobRuns(),
        transcripts: await sweepTranscripts(p.transcript_days),
        assets: await sweepOrphanAssets(),
        usage: await rollUpUsage(p.usage_months),
      };
      ctx.log("retention applied", out);
      return out;
    },
  });
}
