import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import {
  registerSource,
  resolveSource,
  ingestWorkItem,
  recordRun,
  resolveCurrentUserId,
  backfillEmbeddings,
  backfillReferenceEmbeddings,
  backfillCodeEmbeddings,
  EMBEDDING_MODEL,
  env,
  sql,
  loadSettingsIntoEnv,
  getRepoBySlug,
  indexRepo,
  resolveCredential,
  sourceCredentialName,
} from "@tachy/core";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";
import { createAzureDevopsSource } from "@tachy/source-azure-devops";

registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);
registerSource("azure-devops", createAzureDevopsSource);

async function sync(
  sourceSlug: string,
  opts: { since?: string; group?: string },
) {
  const { conn, source } = await resolveSource(sourceSlug);
  let cursor: string | undefined;
  let total = 0;
  do {
    const { items, nextCursor } = await source.listItems({
      updatedSince: opts.since,
      groupKey: opts.group,
      cursor,
    });
    for (const it of items) {
      await ingestWorkItem(conn.id, it);
      total++;
    }
    cursor = nextCursor;
  } while (cursor);
  await recordRun({
    userId: await resolveCurrentUserId(),
    mode: "sync",
    meta: { source: sourceSlug, total },
  });
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

  const [left] = await sql`
    select (select count(*) from knowledge_entries where embedding is null)
             + (select count(*) from reference_doc_chunks where embedding is null)
             + (select count(*) from code_chunks where embedding is null) as n
  `;
  if (Number(left.n) > 0)
    console.log(
      `  warning: ${left.n} row(s) still have no vector (empty text is skipped)`,
    );
}

async function indexRepoCmd(slug: string) {
  const repo = await getRepoBySlug(slug);
  let token: string | undefined;
  if (repo.source_slug) {
    const [conn] = await sql`
      select source_type from source_connections where slug = ${repo.source_slug}
    `;
    if (conn)
      token = await resolveCredential(
        sourceCredentialName(conn.source_type, repo.source_slug),
        {},
      );
  }
  console.log(`indexing ${slug} (${repo.url})...`);
  const res = await indexRepo(slug, { token });
  console.log(
    res.upToDate
      ? `${slug} already at ${res.indexedCommit.slice(0, 12)}`
      : `${slug} @ ${res.indexedCommit.slice(0, 12)}: ${res.filesIndexed} file(s) re-embedded, ${res.filesDeleted} removed, ${res.chunkCount} chunks total`,
  );
}

function runPg(bin: string, args: string[]) {
  const res = spawnSync(bin, args, { stdio: "inherit" });
  if (res.error && (res.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error(
      `${bin} not found on PATH. Install the PostgreSQL client tools to use this command.`,
    );
  }
  if (res.status !== 0)
    throw new Error(`${bin} exited with code ${res.status}`);
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
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const ans = await rl.question(
      `This OVERWRITES the database at ${env.databaseUrl}. Continue? [y/N] `,
    );
    rl.close();
    if (ans.trim().toLowerCase() !== "y") return console.log("aborted");
  }
  runPg("pg_restore", [
    "--clean",
    "--if-exists",
    "-d",
    env.databaseUrl,
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
  index-repo <repo-slug>                           clone/fetch a linked repo and (re)index its code
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
    .map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? "true"];
    }),
) as Record<string, string>;

async function main() {
  switch (cmd) {
    case "sync": {
      if (!positional[0]) throw new Error("sync needs a <source-slug>");

      try {
        await loadSettingsIntoEnv();
      } catch {
        /* settings table may not exist yet */
      }
      return sync(positional[0], { since: args.since, group: args.group });
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
        /* settings table may not exist yet */
      }
      return indexRepoCmd(positional[0]);
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
      // `--embed` with no value arrives as the string "true" from the parser
      // above; the seeder reads that as every corpus.
      return seed({
        scale,
        reset: !!args.reset,
        yes: !!args.yes,
        embed:
          args.embed === undefined
            ? false
            : args.embed === "true"
              ? true
              : (args.embed as EmbedMode),
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
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
