import { sql } from "../infra/db";
import { inBackground } from "../infra/background";

export interface ServerCallOutcome {
  rateLimited?: boolean;
  authFailed?: boolean;
  /** tachy held the call back: every credential's budget was spent. */
  budgetRefused?: boolean;
}

export async function recordServerCall(
  serverId: string,
  outcome: ServerCallOutcome,
): Promise<void> {
  await sql`
    insert into mcp_server_calls
      (server_id, day, calls, rate_limited, auth_failures, budget_refused)
    values (${serverId}, current_date, ${outcome.budgetRefused ? 0 : 1},
            ${outcome.rateLimited ? 1 : 0}, ${outcome.authFailed ? 1 : 0},
            ${outcome.budgetRefused ? 1 : 0})
    on conflict (server_id, day) do update set
      calls = mcp_server_calls.calls + excluded.calls,
      rate_limited = mcp_server_calls.rate_limited + excluded.rate_limited,
      auth_failures = mcp_server_calls.auth_failures + excluded.auth_failures,
      budget_refused = mcp_server_calls.budget_refused + excluded.budget_refused
  `;
}

/** Fire and forget, like `countSourceCall`. */
export function countServerCall(
  serverId: string,
  outcome: ServerCallOutcome,
): void {
  inBackground(
    recordServerCall(serverId, outcome),
    "mcp_server_call_count_failed",
  );
}

export interface ServerTraffic {
  slug: string;
  calls: number;
  rate_limited: number;
  auth_failures: number;
  budget_refused: number;
}

/** Totals per server over the last `days` days, for the console. */
export async function serverTraffic(days = 14): Promise<ServerTraffic[]> {
  const rows = await sql`
    select s.slug,
      coalesce(sum(t.calls), 0)::int as calls,
      coalesce(sum(t.rate_limited), 0)::int as rate_limited,
      coalesce(sum(t.auth_failures), 0)::int as auth_failures,
      coalesce(sum(t.budget_refused), 0)::int as budget_refused
    from mcp_servers s
    left join mcp_server_calls t
      on t.server_id = s.id and t.day > current_date - ${days}::int
    group by s.slug
    order by s.slug
  `;
  return rows as unknown as ServerTraffic[];
}
