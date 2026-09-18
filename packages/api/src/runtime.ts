import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { sql, type EmbedQueueDepth } from "@tachy/core";
import { lifecycle } from "./lifecycle";
import { turnStats } from "./routes/agent";

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

/** Current values only; nothing here is stored. */
export async function runtimeSnapshot() {
  const [mem, postgres, status] = await Promise.all([
    memory(),
    postgresConnections(),
    hostStatus(),
  ]);
  return {
    draining: lifecycle.draining,
    turns: turnStats(),
    memory: mem,
    eventLoopP99Ms: Math.round(loopP99Ms * 10) / 10,
    embed: embedDepth?.() ?? null,
    postgres,
    status,
  };
}
