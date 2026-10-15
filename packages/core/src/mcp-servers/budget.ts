/**
 * The rate budget each credential of a linked server spends. Every chat turn
 * runs its own MCP process, so the count lives in Postgres: a call reserves a
 * slot in every window before it goes out, and a window that is full refuses
 * the reservation for that credential. Windows are fixed, aligned to the epoch.
 */
import type { RateWindow } from "@tachy/contract";
import { sql } from "../infra/db";

/** How long a credential rests after a rate-limit answer, when no window is configured. */
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

/**
 * Takes one call from every window of the credential, or none when any is
 * full. With no windows nothing is counted and the call may go.
 */
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

/** Rests a credential the server refused as rate limited; an earlier rest is never shortened. */
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

/** Until when a rate-limit answer rests the credential: the end of its shortest window. */
export function cooldownEnd(windows: RateWindow[], at = new Date()): Date {
  const shortest = Math.min(...windows.map((window) => window.seconds));
  if (!Number.isFinite(shortest))
    return new Date(at.getTime() + DEFAULT_COOLDOWN_SECONDS * MS_PER_SECOND);
  return windowEnd(at, shortest);
}

export interface CredentialState {
  key: string;
  coolingUntil: Date | null;
  /** Calls spent in each window that is open now. */
  usage: { seconds: number; calls: number; limit: number }[];
  /** When the credential may call again; null when it may now. */
  blockedUntil: Date | null;
}

/** Where each credential stands at `at`, from the windows open then. */
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

/**
 * The credential to call with, its slot already reserved: the least used of
 * those not resting, so a pool spreads its calls. When none has room, when the
 * first of them will.
 */
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

/** Usage rows of windows that closed over a day ago, which no reservation reads again. */
export async function sweepUsage(): Promise<number> {
  const rows = await sql`
    delete from mcp_server_usage
    where window_start + window_seconds * interval '1 second' < now() - interval '1 day'
    returning 1
  `;
  await sql`delete from mcp_server_cooldowns where until < now()`;
  return rows.length;
}
