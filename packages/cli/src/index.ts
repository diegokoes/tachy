import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  registerSource,
  syncSource,
  setSourceOrigin,
} from "@tachy/core/sources";
import {
  repoToken,
  backfillCodeEmbeddings,
  getRepoBySlug,
  indexRepo,
  withoutUrlCredentials,
} from "@tachy/core/code";
import { backfillEmbeddings } from "@tachy/core/knowledge";
import { backfillReferenceEmbeddings } from "@tachy/core/reference";
import { embedBucketChunks } from "@tachy/core/buckets";
import { EMBEDDING_MODEL } from "@tachy/core/search";
import { env, errorText, sql } from "@tachy/core/infra";
import { loadSettingsIntoEnv, rotateVaultKey } from "@tachy/core/config";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";
import { createAzureDevopsSource } from "@tachy/source-azure-devops";

registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);
registerSource("azure-devops", createAzureDevopsSource);

// The CLI's only source traffic is `sync`.
setSourceOrigin("sync");

async function sync(
  sourceSlug: string,
  opts: { since?: string; group?: string },
) {
  const { total, since } = await syncSource(sourceSlug, {
    ...opts,
    onPage: (n, from) => {
      if (n === 0 && from && !opts.since) console.log(`resuming from ${from}`);
    },
  });
  if (!opts.since && since) console.log(`resumed from ${since}`);
  console.log(`synced ${total} item(s) from ${sourceSlug}`);
}

async function embedBackfill(all: boolean) {
  console.log(
    `${all ? "re-embedding everything" : "embedding missing vectors"} with ${EMBEDDING_MODEL}`,
  );
  const entries = await backfillEmbeddings({ all });
  console.log(`  knowledge entries: ${entries}`);
  const chunks = await backfillReferenceEmbeddings({ all });
  console.log(`  reference chunks:  ${chunks}`);
  const code = await backfillCodeEmbeddings({ all });
  console.log(`  code chunks:       ${code}`);
  const buckets = await embedBucketChunks({ all });
  console.log(`  bucket chunks:     ${buckets}`);

  const [left] = await sql`
    select (select count(*) from knowledge_entries where embedding is null)
             + (select count(*) from reference_doc_chunks where embedding is null)
             + (select count(*) from code_blob_chunks where embedding is null)
             + (select count(*) from bucket_doc_chunks where embedding is null) as n
  `;
  if (Number(left.n) > 0)
    console.log(
      `  warning: ${left.n} row(s) still have no vector (empty text is skipped)`,
    );
}

async function indexRepoCmd(slug: string, full: boolean) {
  const repo = await getRepoBySlug(slug);
  const token = await repoToken(slug);
  console.log(
    `indexing ${slug} (${withoutUrlCredentials(repo.url)})${full ? ", every file" : ""}...`,
  );
  const indexed = await indexRepo(slug, { token, full });
  for (const line of indexed.lines)
    console.log(
      line.upToDate
        ? `${slug} ${line.ref} already at ${line.indexedCommit.slice(0, 12)}`
        : `${slug} ${line.ref} @ ${line.indexedCommit.slice(0, 12)}${line.versionLabel ? ` (${line.versionLabel})` : ""}: ${line.filesIndexed} file(s) written, ${line.filesEmbedded} embedded, ${line.filesDeleted} removed, ${line.chunkCount} chunks total`,
    );
}

/**
 * The connection string carries the password, and argv is world-readable via
 * /proc - so it travels in the child's environment instead, and is never printed
 * back. `redactedDbUrl` is what a prompt or a log line gets.
 */
function pgEnv(): NodeJS.ProcessEnv {
  const url = new URL(env.databaseUrl);
  const childEnv = { ...process.env };
  childEnv.PGHOST = url.hostname;
  if (url.port) childEnv.PGPORT = url.port;
  if (url.username) childEnv.PGUSER = decodeURIComponent(url.username);
  if (url.password) childEnv.PGPASSWORD = decodeURIComponent(url.password);
  const db = url.pathname.replace(/^\//, "");
  if (db) childEnv.PGDATABASE = db;
  return childEnv;
}

function redactedDbUrl(): string {
  const url = new URL(env.databaseUrl);
  if (url.password) url.password = "***";
  return url.toString();
}

function runPg(bin: string, args: string[]) {
  const child = spawnSync(bin, args, { stdio: "inherit", env: pgEnv() });
  if (child.error && (child.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error(
      `${bin} not found on PATH. Install the PostgreSQL client tools to use this command.`,
    );
  }
  if (child.status !== 0)
    throw new Error(`${bin} exited with code ${child.status}`);
}

function backup(opts: { out?: string }) {
  const dir = opts.out ?? "./backups";
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const file = join(dir, `tachy-${stamp}.dump`);
  runPg("pg_dump", ["-Fc", "-f", file]);
  console.log(`wrote ${file}`);
}

async function restore(opts: { file?: string; yes?: boolean }) {
  if (!opts.file) throw new Error("restore needs --file=<path-to-.dump>");
  if (!existsSync(opts.file)) throw new Error(`no such file: ${opts.file}`);
  if (!opts.yes) {
    const terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await terminal.question(
      `This OVERWRITES the database at ${redactedDbUrl()}. Continue? [y/N] `,
    );
    terminal.close();
    if (answer.trim().toLowerCase() !== "y") return console.log("aborted");
  }
  runPg("pg_restore", [
    "--clean",
    "--if-exists",
    "-d",
    pgEnv().PGDATABASE!,
    opts.file,
  ]);
  console.log("restore complete");
}

import { seed, SCALE_NAMES, type ScaleName } from "./seed";
import type { EmbedMode } from "./seed/embed";

const USAGE = `usage:
  sync <source-slug> [--since=ISO] [--group=KEY]   pull & store work items
  embed-backfill                                   embed rows missing a vector
  reembed                                          re-embed EVERYTHING (after a model change)
  index-repo <repo-slug> [--full]                  clone/fetch a linked repo and (re)index its code;
                                                   --full redoes every file (new chunk size or model)
  backup [--out=DIR]                               pg_dump -Fc to DIR (default ./backups)
  restore --file=PATH [--yes]                      pg_restore (overwrites the DB)
  seed [--scale=NAME] [--reset] [--yes]            fill a dev database with plausible data
       [--embed[=search|all]]                      real vectors: search = knowledge + reference,
                                                   all also does code (most of the time cost)
                                                   (npm eats --flags: npm run sync -- seed --scale=medium)`;

const [cmd, ...rest] = process.argv.slice(2);
const positional = rest.filter((a) => !a.startsWith("--"));
const args = Object.fromEntries(
  rest
    .filter((a) => a.startsWith("--"))
    .map((flag) => {
      const [key, value] = flag.replace(/^--/, "").split("=");
      return [key, value ?? "true"];
    }),
) as Record<string, string>;

async function main() {
  switch (cmd) {
    case "sync": {
      if (!positional[0]) throw new Error("sync needs a <source-slug>");

      try {
        await loadSettingsIntoEnv();
      } catch {
        // settings table may not exist yet
      }
      return sync(positional[0], { since: args.since, group: args.group });
    }
    case "rotate-key": {
      const { moved, already } = await rotateVaultKey();
      console.log(
        `re-encrypted ${moved} credential(s) with the current key; ${already} were already on it`,
      );
      console.log(
        "once every row is on it, remove TACHY_SECRET_KEY_PREVIOUS from .env",
      );
      return;
    }
    case "embed-backfill":
      return embedBackfill(false);
    case "reembed":
      return embedBackfill(true);
    case "index-repo": {
      if (!positional[0]) throw new Error("index-repo needs a <repo-slug>");
      try {
        await loadSettingsIntoEnv();
      } catch {
        // settings table may not exist yet
      }
      return indexRepoCmd(positional[0], !!args.full);
    }
    case "backup":
      return backup({ out: args.out });
    case "restore":
      return restore({ file: args.file, yes: !!args.yes });
    case "seed": {
      const scale = (args.scale ?? "small") as ScaleName;
      if (!SCALE_NAMES.includes(scale))
        throw new Error(
          `unknown --scale '${args.scale}' (${SCALE_NAMES.join("|")})`,
        );
      // `--embed` with no value is the string "true" in `args`; the seeder
      // reads that as every corpus.
      let embed: boolean | EmbedMode = false;
      if (args.embed === "true") embed = true;
      else if (args.embed !== undefined) embed = args.embed as EmbedMode;
      return seed({
        scale,
        reset: !!args.reset,
        yes: !!args.yes,
        embed,
      });
    }
    default:
      console.log(USAGE);
      process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(errorText(e));
    process.exit(1);
  });
