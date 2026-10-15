/**
 * Per-credential rate budget, in Postgres because each turn runs its own MCP
 * process. A call reserves a slot in every window before it is sent; a full
 * window refuses it. Windows are fixed and epoch-aligned.
 */
import type { RateWindow } from "@tachy/contract";
import { sql } from "../infra/db";

/** Rest after a rate-limit answer when the server has no windows. */
export const DEFAULT_COOLDOWN_SECONDS = 60;

const MS_PER_SECOND = 1000;

export function windowStart(at: Date, seconds: number): Date {
  const spanMs = seconds * MS_PER_SECOND;
  return new Date(Math.floor(at.getTime() / spanMs) * spanMs);
}

export function windowEnd(at: Date, seconds: number): Date {
  return new Date(windowStart(at, seconds).getTime() + seconds * MS_PER_SECOND);
}

class WindowFull extends Error {}

/** One call from every window, or none if any is full. No windows: allowed, not counted. */
export async function reserveCall(
  serverId: string,
  credentialKey: string,
  windows: RateWindow[],
  at = new Date(),
): Promise<boolean> {
  if (!windows.length) return true;
  try {
    await sql.begin(async (tx) => {
      for (const window of windows) {
        const start = windowStart(at, window.seconds);
        const rows = await tx`
          insert into mcp_server_usage
            (server_id, credential_key, window_seconds, window_start, calls)
          values (${serverId}, ${credentialKey}, ${window.seconds}, ${start}, 1)
          on conflict (server_id, credential_key, window_seconds, window_start)
          do update set calls = mcp_server_usage.calls + 1
          where mcp_server_usage.calls < ${window.limit}
          returning calls
        `;
        if (!rows.length) throw new WindowFull();
      }
    });
    return true;
  } catch (err) {
    if (err instanceof WindowFull) return false;
    throw err;
  }
}

/** Never shortens an existing rest. */
export async function coolDown(
  serverId: string,
  credentialKey: string,
  until: Date,
): Promise<void> {
  await sql`
    insert into mcp_server_cooldowns (server_id, credential_key, until)
    values (${serverId}, ${credentialKey}, ${until})
    on conflict (server_id, credential_key)
    do update set until = greatest(mcp_server_cooldowns.until, excluded.until)
  `;
}

/** End of the shortest window. */
export function cooldownEnd(windows: RateWindow[], at = new Date()): Date {
  const shortest = Math.min(...windows.map((window) => window.seconds));
  if (!Number.isFinite(shortest))
    return new Date(at.getTime() + DEFAULT_COOLDOWN_SECONDS * MS_PER_SECOND);
  return windowEnd(at, shortest);
}

export interface CredentialState {
  key: string;
  coolingUntil: Date | null;
  /** Calls in each currently open window. */
  usage: { seconds: number; calls: number; limit: number }[];
  /** Null: may call now. */
  blockedUntil: Date | null;
}

export async function credentialStates(
  serverId: string,
  keys: string[],
  windows: RateWindow[],
  at = new Date(),
): Promise<CredentialState[]> {
  const [usageRows, cooldownRows] = await Promise.all([
    sql`
      select credential_key, window_seconds, window_start, calls
      from mcp_server_usage
      where server_id = ${serverId} and credential_key = any(${keys})
        and window_start + window_seconds * interval '1 second' > ${at}
    `,
    sql`
      select credential_key, until from mcp_server_cooldowns
      where server_id = ${serverId} and credential_key = any(${keys})
        and until > ${at}
    `,
  ]);
  return keys.map((key) => {
    const cooling = cooldownRows.find((row) => row.credential_key === key);
    const coolingUntil = cooling ? new Date(cooling.until) : null;
    const usage = windows.map((window) => {
      const start = windowStart(at, window.seconds).getTime();
      const row = usageRows.find(
        (candidate) =>
          candidate.credential_key === key &&
          candidate.window_seconds === window.seconds &&
          new Date(candidate.window_start).getTime() === start,
      );
      return { ...window, calls: (row?.calls as number | undefined) ?? 0 };
    });
    const ends = usage
      .filter((window) => window.calls >= window.limit)
      .map((window) => windowEnd(at, window.seconds).getTime());
    if (coolingUntil) ends.push(coolingUntil.getTime());
    const blockedUntil = ends.length ? new Date(Math.max(...ends)) : null;
    return { key, coolingUntil, usage, blockedUntil };
  });
}

export type CredentialPick<T> = { credential: T } | { resetsAt: Date | null };

function earliestReset(states: CredentialState[]): Date | null {
  const times = states
    .map((state) => state.blockedUntil?.getTime())
    .filter((time): time is number => time !== undefined);
  return times.length ? new Date(Math.min(...times)) : null;
}

/** Reserves a slot on the least used credential not resting; without room, the earliest reset. */
export async function pickCredential<T extends { key: string }>(
  serverId: string,
  candidates: T[],
  windows: RateWindow[],
  at = new Date(),
): Promise<CredentialPick<T>> {
  const keys = candidates.map((candidate) => candidate.key);
  const states = await credentialStates(serverId, keys, windows, at);
  const shortest = windows.reduce(
    (best, window, index) =>
      window.seconds < (windows[best]?.seconds ?? Infinity) ? index : best,
    0,
  );
  const spent = (key: string) =>
    states.find((state) => state.key === key)?.usage[shortest]?.calls ?? 0;
  const open = candidates
    .filter(
      (candidate) =>
        !states.find((state) => state.key === candidate.key)?.blockedUntil,
    )
    .sort((a, b) => spent(a.key) - spent(b.key));
  for (const candidate of open)
    if (await reserveCall(serverId, candidate.key, windows, at))
      return { credential: candidate };
  // A reservation can lose to another turn's, so the states are read again.
  return {
    resetsAt: earliestReset(
      await credentialStates(serverId, keys, windows, at),
    ),
  };
}

/** Deletes usage of windows closed over a day ago, and expired rests. */
export async function sweepUsage(): Promise<number> {
  const rows = await sql`
    delete from mcp_server_usage
    where window_start + window_seconds * interval '1 second' < now() - interval '1 day'
    returning 1
  `;
  await sql`delete from mcp_server_cooldowns where until < now()`;
  return rows.length;
}
