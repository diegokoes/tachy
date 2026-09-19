import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import {
  env,
  issueFlag,
  sql,
  vaultState,
  type EmbedQueueDepth,
  type IssueList,
} from "@tachy/core";
import { lifecycle, readiness } from "./lifecycle";
import { turnStats } from "./turns";

const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();
let loopP99Ms = 0;
setInterval(() => {
  loopP99Ms = loopDelay.percentile(99) / 1e6;
  loopDelay.reset();
}, 60_000).unref();

let embedDepth: (() => EmbedQueueDepth) | undefined;
export const setEmbedDepth = (fn: typeof embedDepth) => (embedDepth = fn);

const readNumber = async (path: string) => {
  const raw = (await readFile(path, "utf8").catch(() => "")).trim();
  return raw && raw !== "max" ? Number(raw) : null;
};

/** The container's own cgroup: turn trees live inside it, so it is the capacity signal. */
async function memory() {
  const current = await readNumber("/sys/fs/cgroup/memory.current");
  if (current === null) return null;
  const max = await readNumber("/sys/fs/cgroup/memory.max");
  return {
    currentBytes: current,
    maxBytes: max,
    percent: max ? Math.round((current / max) * 1000) / 10 : null,
  };
}

async function postgresConnections() {
  try {
    const rows = await sql<{ name: string; state: string; n: number }[]>`
      select coalesce(nullif(application_name, ''), '(unnamed)') as name,
             coalesce(state, 'unknown') as state,
             count(*)::int as n
      from pg_stat_activity
      where datname = current_database()
      group by 1, 2
      order by 1, 2
    `;
    const [{ max }] = await sql<{ max: number }[]>`
      select setting::int as max from pg_settings where name = 'max_connections'
    `;
    return { max, byProcess: rows };
  } catch (err) {
    return { error: String(err) };
  }
}

/**
 * The host writes JSON status files (backups, restore test, downloads, disk,
 * temperature) into a directory mounted read-only here, which is how the admin
 * page shows host state without any access to the host.
 */
async function hostStatus() {
  const dir = process.env.TACHY_STATUS_DIR;
  if (!dir) return null;
  const out: Record<string, unknown> = {};
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
    const raw = await readFile(join(dir, name), "utf8").catch(() => null);
    try {
      out[name.slice(0, -5)] = raw === null ? null : JSON.parse(raw);
    } catch {
      out[name.slice(0, -5)] = { error: "unreadable" };
    }
  }
  return out;
}

/**
 * The same scripts append each result to `<name>.jsonl` beside the status file,
 * keeping the last few dozen, which is the only history a backup or a deploy
 * has. A line cut short by a crash mid-write is skipped rather than failing the
 * whole list.
 */
export async function hostHistory(dir = process.env.TACHY_STATUS_DIR) {
  if (!dir) return null;
  const out: Record<string, Record<string, unknown>[]> = {};
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names.filter((n) => n.endsWith(".jsonl")).sort()) {
    const raw = await readFile(join(dir, name), "utf8").catch(() => "");
    out[name.slice(0, -6)] = raw
      .split("\n")
      .flatMap((line) => {
        if (!line.trim()) return [];
        try {
          const row = JSON.parse(line);
          return row && typeof row === "object" ? [row] : [];
        } catch {
          return [];
        }
      })
      .slice(-60);
  }
  return out;
}

async function externalDepth(): Promise<EmbedQueueDepth | null> {
  if (!lifecycle.embedderUrl) return null;
  return fetch(lifecycle.embedderUrl, { signal: AbortSignal.timeout(2_000) })
    .then(
      async (r) =>
        ((await r.json()) as { depth?: EmbedQueueDepth }).depth ?? null,
    )
    .catch(() => null);
}

async function tableSizes() {
  return sql<{ table: string; bytes: number; rows: number }[]>`
    select c.relname as table, pg_total_relation_size(c.oid)::float8 as bytes,
           c.reltuples::float8 as rows
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname = current_schema()
    order by pg_total_relation_size(c.oid) desc
    limit 12
  `.catch(() => []);
}

async function security() {
  const vault = await vaultState();
  const [row] = await sql`
    select count(*) filter (where password_hash is not null and not disabled)::int as with_password,
           count(*) filter (where password_login_allowed and not disabled)::int as password_under_sso,
           count(*) filter (where service_account and not disabled)::int as service_accounts
    from users
  `;
  return {
    vault,
    sso_configured: Boolean(env.oidc),
    users_with_password: row.with_password as number,
    password_login_under_sso: row.password_under_sso as number,
    service_accounts: row.service_accounts as number,
  };
}

/** Current values only; nothing here is stored. */
export async function runtimeSnapshot() {
  const [mem, postgres, status, history, ready, sizes, sec] = await Promise.all(
    [
      memory(),
      postgresConnections(),
      hostStatus(),
      hostHistory(),
      readiness(),
      tableSizes(),
      security(),
    ],
  );
  return {
    draining: lifecycle.draining,
    refusingChats: lifecycle.refusingChats,
    readiness: ready,
    tableSizes: sizes,
    security: sec,
    uploadTtlHours: Number(process.env.TACHY_UPLOAD_TTL_HOURS) || 24,
    turns: turnStats(),
    memory: mem,
    eventLoopP99Ms: Math.round(loopP99Ms * 10) / 10,
    embed: embedDepth?.() ?? (await externalDepth()),
    postgres,
    status,
    history,
    uptimeSeconds: Math.round(process.uptime()),
  };
}

type Snapshot = Awaited<ReturnType<typeof runtimeSnapshot>>;
type Result = {
  ok?: boolean;
  at?: string;
  error?: string;
  problems?: string;
  file?: string;
};

const HOUR = 3_600_000;
const olderThan = (at: string | undefined, ms: number, now: number) =>
  !at || now - Date.parse(at) > ms;
const named = (labels: string[]): IssueList => ({
  n: labels.length,
  items: labels.map((label) => ({ key: label, label })),
});

/**
 * What an admin has to act on for the deployment itself. Backup and watch
 * issues only exist where the host writes its status directory; without one
 * there is nothing to say about them either way.
 */
export function systemIssues(
  r: Snapshot,
  now = Date.now(),
): Record<string, IssueList> {
  const ready = r.readiness;
  const status = (r.status ?? null) as Record<string, unknown> | null;
  const backup = status?.backup as Result | undefined;
  const restore = status?.restore as Result | undefined;
  const watch = status?.watch as
    { checks?: Record<string, { state: string; value: string }> } | undefined;
  const checks = Object.entries(watch?.checks ?? {});
  const byState = (state: string) =>
    named(
      checks
        .filter(([, c]) => c.state === state)
        .map(([k, c]) => `${k}: ${c.value}`),
    );
  return {
    "system.not_ready": named(
      [
        !ready.database && "database down",
        ready.schema === "mismatch" && "schema does not match the image",
        ready.model === "loading" && "embedding model still loading",
        ready.model === "unreachable" && "embedder unreachable",
        ready.draining && "draining for shutdown",
      ].filter((x): x is string => Boolean(x)),
    ),
    "backups.failed": named(
      backup && backup.ok === false
        ? [backup.error ?? "no error recorded"]
        : [],
    ),
    "backups.stale": issueFlag(
      Boolean(status) &&
        backup?.ok !== false &&
        olderThan(backup?.at, 12 * HOUR, now),
    ),
    "restore.failed": named(
      restore && restore.ok === false
        ? [restore.problems || "no detail recorded"]
        : [],
    ),
    "restore.stale": issueFlag(
      Boolean(status) &&
        restore?.ok !== false &&
        olderThan(restore?.at, 8 * 24 * HOUR, now),
    ),
    "watch.fail": byState("fail"),
    "watch.warn": byState("warn"),
    "vault.old_keys": named(
      r.security.vault.enabled
        ? r.security.vault.by_key
            .filter((k) => !k.current)
            .map((k) => `${k.key_id ?? "no key id"}: ${k.count}`)
        : [],
    ),
  };
}
