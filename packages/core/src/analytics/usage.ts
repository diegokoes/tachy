import { sql } from "../infra/db";
import { estimateCostUsd } from "./runs";

export interface AgentUsage {
  days: number;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  /**
   * What the provider reported where it reported anything, list price for the
   * rest. A subscription is not billed per token, so this measures consumption
   * rather than an invoice.
   */
  cost_usd: number;
  active_7d: number;
  /** Distinct people with a turn anywhere in the window. */
  active: number;
  /** Tokens and turns per day, oldest first, gaps filled; `models` splits the tokens. */
  per_day: {
    day: string;
    turns: number;
    tokens: number;
    models: Record<string, number>;
  }[];
  by_model: { model: string; turns: number; tokens: number }[];
  /** Heaviest users first. Omitted by the route for anyone not an app admin. */
  top_users?: {
    email: string;
    turns: number;
    tokens: number;
    cost_usd: number;
  }[];
}

/**
 * Rows grouped by model with the tokens no provider priced split out. A backend
 * records `cost_usd: 0` when its SDK reports nothing, so zero means "unknown",
 * not "free" — those tokens are priced here with the same table `recordRun`
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
  const perDayWindow = Math.min(days, 14);
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
    .slice(0, 5);
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
    top_users,
  };
}
