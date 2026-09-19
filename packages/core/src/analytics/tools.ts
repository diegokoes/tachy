import { sql } from "../infra/db";
import { inBackground } from "../infra/background";
import type { ToolUsage } from "@tachy/contract";

export type { ToolUsage };

export interface ToolCallOutcome {
  ok: boolean;
  /** Refused as bad input — the agent held the tool wrong. */
  misuse: boolean;
}

/** True for a service account, whose activity is not engagement. */
export const SERVICE_ACCOUNT = (userId: string | null) =>
  sql`coalesce((select service_account from users where id = ${userId}::uuid), false)`;

/** Record one agent tool call in its tool/person/day bucket. */
export async function recordToolCall(
  tool: string,
  writes: boolean,
  userId: string | null,
  outcome: ToolCallOutcome,
): Promise<void> {
  await sql`
    insert into mcp_tool_calls (tool, writes, user_id, day, calls, failures, misuse)
    select ${tool}, ${writes}, ${userId}::uuid, current_date, 1,
           ${outcome.ok ? 0 : 1}, ${outcome.misuse ? 1 : 0}
    where not ${SERVICE_ACCOUNT(userId)}
    on conflict (tool, user_id, day) do update set
      calls = mcp_tool_calls.calls + 1,
      failures = mcp_tool_calls.failures + excluded.failures,
      misuse = mcp_tool_calls.misuse + excluded.misuse,
      writes = excluded.writes
  `;
}

/**
 * Fire and forget: the tool's answer must never wait on its own bookkeeping,
 * and a failure to count is not a failure to act.
 */
export function countToolCall(
  tool: string,
  writes: boolean,
  userId: string | null,
  outcome: ToolCallOutcome,
): void {
  inBackground(
    recordToolCall(tool, writes, userId, outcome),
    "tool_call_count_failed",
  );
}

/** Tool use over the last `days` days, for the access overview. */
export async function toolUsageCensus(days = 30): Promise<ToolUsage> {
  const [totals] = await sql`
    select
      coalesce(sum(calls) filter (where not writes), 0)::int as reads,
      coalesce(sum(calls) filter (where writes), 0)::int as writes
    from mcp_tool_calls
    where day > current_date - ${days}::int
  `;
  const tools = await sql`
    select tool, bool_or(writes) as writes,
           sum(calls)::int as calls, sum(failures)::int as failures,
           sum(misuse)::int as misuse
    from mcp_tool_calls
    where day > current_date - ${days}::int
    group by tool
    order by sum(calls) desc, tool
    limit 12
  `;
  const writers = await sql`
    select u.email, sum(t.calls)::int as writes
    from mcp_tool_calls t
    join users u on u.id = t.user_id
    where t.writes and t.day > current_date - ${days}::int
    group by u.email
    order by sum(t.calls) desc, u.email
    limit 5
  `;
  const perDayWindow = Math.min(days, 14);
  const per_day = await sql`
    select to_char(d.day, 'YYYY-MM-DD') as day,
      coalesce(sum(t.calls) filter (where not t.writes), 0)::int as reads,
      coalesce(sum(t.calls) filter (where t.writes), 0)::int as writes
    from generate_series(current_date - ${perDayWindow - 1}::int, current_date, interval '1 day') as d(day)
    left join mcp_tool_calls t on t.day = d.day::date
    group by d.day
    order by d.day
  `;
  return {
    days,
    reads: totals.reads as number,
    writes: totals.writes as number,
    per_day: [...per_day] as unknown as ToolUsage["per_day"],
    tools: [...tools] as unknown as ToolUsage["tools"],
    writers: [...writers] as unknown as NonNullable<ToolUsage["writers"]>,
  };
}
