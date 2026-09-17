import { SOURCE_CALL_ORIGINS, type SourceCallOrigin } from "@tachy/contract";
import { sql } from "../infra/db";
import { inBackground } from "../infra/background";

export { SOURCE_CALL_ORIGINS };
export type { SourceCallOrigin };

/**
 * Who this process spends source calls on behalf of. Set once at the entry
 * point — the MCP server is the agent, the CLI is sync — rather than threaded
 * through every adapter call, because a process only ever plays one of them.
 * The API is the default.
 */
let origin: SourceCallOrigin = "app";

export function setSourceOrigin(next: SourceCallOrigin): void {
  origin = next;
}

export interface SourceCallOutcome {
  /** The far end asked us to back off at least once, retries included. */
  rateLimited: boolean;
  /** The last answer refused the credentials. */
  authFailed: boolean;
}

/**
 * Record one logical call against a connection. A slug with no connection row —
 * an ad-hoc client, a test double — matches nothing and records nothing.
 */
export async function recordSourceCall(
  connection: string,
  outcome: SourceCallOutcome,
): Promise<void> {
  await sql`
    insert into source_calls
      (source_connection_id, day, origin, calls, rate_limited, auth_failures)
    select id, current_date, ${origin}, 1,
           ${outcome.rateLimited ? 1 : 0}, ${outcome.authFailed ? 1 : 0}
    from source_connections where slug = ${connection}
    on conflict (source_connection_id, day, origin) do update set
      calls = source_calls.calls + 1,
      rate_limited = source_calls.rate_limited + excluded.rate_limited,
      auth_failures = source_calls.auth_failures + excluded.auth_failures
  `;
}

/**
 * Fire and forget, like `countView`: a source read must never wait on its own
 * bookkeeping, and a failure to count is not a failure to read.
 */
export function countSourceCall(
  connection: string,
  outcome: SourceCallOutcome,
): void {
  inBackground(
    recordSourceCall(connection, outcome),
    "source_call_count_failed",
  );
}

export interface SourceTraffic {
  days: number;
  /** One row per connection that had any traffic in the window. */
  connections: {
    slug: string;
    source_type: string;
    agent: number;
    sync: number;
    app: number;
    rate_limited: number;
    auth_failures: number;
    /** Most recent day the far end refused the credentials, if any. */
    last_auth_failure: string | null;
  }[];
  /** Calls per day across every connection, oldest first, gaps filled. */
  per_day: { day: string; agent: number; sync: number; app: number }[];
}

/** Traffic over the last `days` days, for the connect overview. */
export async function sourceTrafficCensus(days = 14): Promise<SourceTraffic> {
  const since = days - 1;
  const connections = await sql`
    select c.slug, c.source_type,
      coalesce(sum(t.calls) filter (where t.origin = 'agent'), 0)::int as agent,
      coalesce(sum(t.calls) filter (where t.origin = 'sync'), 0)::int as sync,
      coalesce(sum(t.calls) filter (where t.origin = 'app'), 0)::int as app,
      coalesce(sum(t.rate_limited), 0)::int as rate_limited,
      coalesce(sum(t.auth_failures), 0)::int as auth_failures,
      to_char(max(t.day) filter (where t.auth_failures > 0), 'YYYY-MM-DD')
        as last_auth_failure
    from source_calls t
    join source_connections c on c.id = t.source_connection_id
    where t.day > current_date - ${since + 1}::int
    group by c.slug, c.source_type
    order by sum(t.calls) desc, c.slug
  `;
  const per_day = await sql`
    select to_char(d.day, 'YYYY-MM-DD') as day,
      coalesce(sum(t.calls) filter (where t.origin = 'agent'), 0)::int as agent,
      coalesce(sum(t.calls) filter (where t.origin = 'sync'), 0)::int as sync,
      coalesce(sum(t.calls) filter (where t.origin = 'app'), 0)::int as app
    from generate_series(current_date - ${since}::int, current_date, interval '1 day') as d(day)
    left join source_calls t on t.day = d.day::date
    group by d.day
    order by d.day
  `;
  return {
    days,
    connections: [...connections] as unknown as SourceTraffic["connections"],
    per_day: [...per_day] as unknown as SourceTraffic["per_day"],
  };
}
