import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import {
  registerSource, resolveSource, ingestWorkItem, recordRun, resolveCurrentUserId,
  backfillEmbeddings, env, sql, loadSettingsIntoEnv,
} from "@tachy/core";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";

registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);

async function sync(sourceSlug: string, opts: { since?: string; group?: string }) {
  const { conn, source } = await resolveSource(sourceSlug);
  let cursor: string | undefined;
  let total = 0;
  do {
    const { items, nextCursor } = await source.listItems({
      updatedSince: opts.since, groupKey: opts.group, cursor,
    });
    for (const it of items) {
      await ingestWorkItem(conn.id, it);
      total++;
    }
    cursor = nextCursor;
  } while (cursor);
  await recordRun({ userId: await resolveCurrentUserId(), mode: "sync", meta: { source: sourceSlug, total } });
  console.log(`synced ${total} item(s) from ${sourceSlug}`);
}

async function embedBackfill() {
  const n = await backfillEmbeddings();
  console.log(`embedded ${n} entr${n === 1 ? "y" : "ies"}`);
}



async function migrate(opts: { dir?: string }) {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = opts.dir ?? join(here, "..", "..", "..", "db", "migrations");
  if (!existsSync(dir)) throw new Error(`no migrations directory at ${dir}`);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const content = readFileSync(join(dir, f), "utf8");
    await sql.begin((tx) => tx.unsafe(content)); 
    console.log(`applied ${f}`);
  }
  if (files.length === 0) console.log("no migrations found");
}

function runPg(bin: string, args: string[]) {
  const res = spawnSync(bin, args, { stdio: "inherit" });
  if (res.error && (res.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error(`${bin} not found on PATH. Install the PostgreSQL client tools to use this command.`);
  }
  if (res.status !== 0) throw new Error(`${bin} exited with code ${res.status}`);
}

function backup(opts: { out?: string }) {
  const dir = opts.out ?? "./backups";
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const file = join(dir, `tachy-${stamp}.dump`);
  runPg("pg_dump", ["-Fc", "-d", env.databaseUrl, "-f", file]);
  console.log(`wrote ${file}`);
}

async function restore(opts: { file?: string; yes?: boolean }) {
  if (!opts.file) throw new Error("restore needs --file=<path-to-.dump>");
  if (!existsSync(opts.file)) throw new Error(`no such file: ${opts.file}`);
  if (!opts.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question(`This OVERWRITES the database at ${env.databaseUrl}. Continue? [y/N] `);
    rl.close();
    if (ans.trim().toLowerCase() !== "y") return console.log("aborted");
  }
  runPg("pg_restore", ["--clean", "--if-exists", "-d", env.databaseUrl, opts.file]);
  console.log("restore complete");
}

const USAGE = `usage:
  sync <source-slug> [--since=ISO] [--group=KEY]   pull & store work items
  embed-backfill                                   embed entries missing a vector
  migrate [--dir=PATH]                             apply db/migrations/*.sql (idempotent)
  backup [--out=DIR]                               pg_dump -Fc to DIR (default ./backups)
  restore --file=PATH [--yes]                      pg_restore (overwrites the DB)`;

const [cmd, ...rest] = process.argv.slice(2);
const positional = rest.filter((a) => !a.startsWith("--"));
const args = Object.fromEntries(
  rest.filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
) as Record<string, string>;

async function main() {
  switch (cmd) {
    case "sync": {
      if (!positional[0]) throw new Error("sync needs a <source-slug>");
      
      try { await loadSettingsIntoEnv(); } catch { /* settings table may not exist yet */ }
      return sync(positional[0], { since: args.since, group: args.group });
    }
    case "embed-backfill": return embedBackfill();
    case "migrate": return migrate({ dir: args.dir });
    case "backup": return backup({ out: args.out });
    case "restore": return restore({ file: args.file, yes: !!args.yes });
    default:
      console.log(USAGE);
      process.exit(1);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
