import { sql } from "../infra/db";
import { estimateCostUsd } from "./runs";
import type { AgentUsage } from "@tachy/contract";

export type { AgentUsage };

/**
 * Rows grouped by model with the tokens no provider priced split out. A backend
 * records `cost_usd: 0` when its SDK reports nothing, so zero means "unknown",
 * not "free" - those tokens are priced here with the same table `recordRun`
 * estimates from, and rows written before the estimate existed get one too.
 */
interface Priced {
  model: string | null;
  reported: number;
  unpriced_in: number;
  unpriced_out: number;
}

const costOf = (rows: Priced[]) =>
  rows.reduce(
    (sum, r) =>
      sum +
      r.reported +
      (estimateCostUsd(r.model, r.unpriced_in, r.unpriced_out) ?? 0),
    0,
  );

const REPORTED = sql`nullif((meta->>'cost_usd')::numeric, 0)`;

/**
 * What flows spent on the model: each `agent.ask` step records a run of mode
 * `flow` naming its flow. A flow deleted since still counts, under no name.
 */
async function flowUsage(days: number): Promise<AgentUsage["flows"]> {
  const rows = (await sql`
    select f.id, coalesce(f.name, '(deleted flow)') as name, r.model,
      count(*)::int as calls,
      coalesce(sum(coalesce(r.input_tokens, 0) + coalesce(r.output_tokens, 0)), 0)::bigint::float8
        as tokens,
      coalesce(sum(${REPORTED}), 0)::float8 as reported,
      coalesce(sum(r.input_tokens) filter (where ${REPORTED} is null), 0)::bigint::float8
        as unpriced_in,
      coalesce(sum(r.output_tokens) filter (where ${REPORTED} is null), 0)::bigint::float8
        as unpriced_out
    from analysis_runs r
    left join flows f on f.id::text = r.meta->>'flow_id'
    where r.mode = 'flow' and r.created_at > now() - make_interval(days => ${days})
    group by f.id, f.name, r.model
  `) as unknown as (Priced & {
    id: string | null;
    name: string;
    calls: number;
    tokens: number;
  })[];
  const byFlow = new Map<string, AgentUsage["flows"]["by_flow"][number]>();
  for (const r of rows) {
    const key = r.id ?? "";
    const f = byFlow.get(key) ?? {
      id: r.id,
      name: r.name,
      calls: 0,
      tokens: 0,
      cost_usd: 0,
    };
    f.calls += r.calls;
    f.tokens += r.tokens;
    f.cost_usd += costOf([r]);
    byFlow.set(key, f);
  }
  const by_flow = [...byFlow.values()].sort(
    (a, b) => b.cost_usd - a.cost_usd || b.calls - a.calls,
  );
  return {
    calls: by_flow.reduce((n, f) => n + f.calls, 0),
    tokens: by_flow.reduce((n, f) => n + f.tokens, 0),
    cost_usd: by_flow.reduce((n, f) => n + f.cost_usd, 0),
    by_flow: by_flow.slice(0, 10),
  };
}

/**
 * Agent consumption over the last `days` days, from `analysis_runs`.
 *
 * Chat rows only. Tools such as `fetch_work_item` write runs of their own with
 * no token figures, and the one row per turn that the agent route records is
 * the only one that carries what the turn actually cost.
 */
export async function agentUsageCensus(days = 30): Promise<AgentUsage> {
  const [totals] = await sql`
    select
      count(*)::int as turns,
      coalesce(sum(input_tokens), 0)::bigint::float8 as input_tokens,
      coalesce(sum(output_tokens), 0)::bigint::float8 as output_tokens,
      count(distinct user_id) filter (where created_at > now() - interval '7 days')::int
        as active_7d,
      count(distinct user_id)::int as active
    from analysis_runs
    where mode = 'chat' and created_at > now() - make_interval(days => ${days})
  `;
  const perDayWindow = Math.min(days, 90);
  const per_day = await sql`
    select to_char(d.day, 'YYYY-MM-DD') as day,
      count(r.id)::int as turns,
      coalesce(sum(coalesce(r.input_tokens, 0) + coalesce(r.output_tokens, 0)), 0)::bigint::float8
        as tokens
    from generate_series(current_date - ${perDayWindow - 1}::int, current_date, interval '1 day') as d(day)
    left join analysis_runs r
      on r.mode = 'chat' and r.created_at::date = d.day::date
    group by d.day
    order by d.day
  `;
  const perDayModel = await sql`
    select to_char(created_at::date, 'YYYY-MM-DD') as day,
      coalesce(model, 'unknown') as model,
      coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0)::bigint::float8
        as tokens
    from analysis_runs
    where mode = 'chat' and created_at::date > current_date - ${perDayWindow}::int
    group by 1, 2
  `;
  const models = new Map<string, Record<string, number>>();
  for (const r of perDayModel) {
    const day = models.get(r.day) ?? {};
    day[r.model as string] = r.tokens as number;
    models.set(r.day, day);
  }
  const by_model = await sql`
    select coalesce(model, 'unknown') as model, count(*)::int as turns,
      coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0)::bigint::float8
        as tokens
    from analysis_runs
    where mode = 'chat' and created_at > now() - make_interval(days => ${days})
    group by coalesce(model, 'unknown')
    order by 3 desc, 1
  `;
  const priced = await sql`
    select u.email, r.model,
      count(*)::int as turns,
      coalesce(sum(coalesce(r.input_tokens, 0) + coalesce(r.output_tokens, 0)), 0)::bigint::float8
        as tokens,
      coalesce(sum(${REPORTED}), 0)::float8 as reported,
      coalesce(sum(r.input_tokens) filter (where ${REPORTED} is null), 0)::bigint::float8
        as unpriced_in,
      coalesce(sum(r.output_tokens) filter (where ${REPORTED} is null), 0)::bigint::float8
        as unpriced_out
    from analysis_runs r
    left join users u on u.id = r.user_id
    where r.mode = 'chat' and r.created_at > now() - make_interval(days => ${days})
    group by u.email, r.model
  `;
  const rows = [...priced] as unknown as (Priced & {
    email: string | null;
    turns: number;
    tokens: number;
  })[];

  const people = new Map<
    string,
    { email: string; turns: number; tokens: number; cost_usd: number }
  >();
  for (const r of rows) {
    if (!r.email) continue;
    const p = people.get(r.email) ?? {
      email: r.email,
      turns: 0,
      tokens: 0,
      cost_usd: 0,
    };
    p.turns += r.turns;
    p.tokens += r.tokens;
    p.cost_usd += costOf([r]);
    people.set(r.email, p);
  }
  const top_users = [...people.values()]
    .sort((a, b) => b.tokens - a.tokens || a.email.localeCompare(b.email))
    .slice(0, 25);
  return {
    days,
    turns: totals.turns as number,
    input_tokens: totals.input_tokens as number,
    output_tokens: totals.output_tokens as number,
    cost_usd: costOf(rows),
    active_7d: totals.active_7d as number,
    active: totals.active as number,
    per_day: per_day.map((d) => ({
      day: d.day as string,
      turns: d.turns as number,
      tokens: d.tokens as number,
      models: models.get(d.day) ?? {},
    })),
    by_model: [...by_model] as unknown as AgentUsage["by_model"],
    flows: await flowUsage(days),
    top_users,
  };
}
