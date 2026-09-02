import { createInterface } from "node:readline/promises";
import {
  AGENT_CREDENTIALS,
  clearPermissionCache,
  env,
  secretsEnabled,
  setCredential,
  setSetting,
  sql,
} from "@tachy/core";
import type { Tx } from "./batches";
import { SCALES, SCALE_NAMES, type ScaleName } from "./scale";
import { seedOrg, ADMIN_EMAIL, DEV_PASSWORD, MEMBER_EMAIL } from "./org";
import { seedCatalog } from "./catalog";
import { seedSources } from "./sources";
import {
  deriveProductAreas,
  seedKnowledge,
  type Knowledge,
  supersede,
} from "./knowledge";
import {
  EMBED_MODES,
  embedEstimateSeconds,
  realEmbedder,
  syntheticEmbedder,
  type EmbedMode,
} from "./embed";
import { seedCode } from "./code";
import { seedActivity } from "./activity";
import { seedLibrary } from "./library";
import { seedWiki } from "./wiki";

export { SCALE_NAMES, type ScaleName } from "./scale";
export { ADMIN_EMAIL, MEMBER_EMAIL, DEV_PASSWORD } from "./org";

export interface SeedOptions {
  scale: ScaleName;
  reset: boolean;
  yes: boolean;
  /** `true` is kept for callers that predate the modes and means "all". */
  embed: boolean | EmbedMode;
}

/**
 * Marks a database as one this command created, so a re-seed is allowed but a
 * database holding data the seeder did not write is refused. Deliberately not
 * in SETTING_SCHEMAS: getSettings() only reads keys it knows, so this can
 * never reach application behaviour.
 */
const MARKER = "dev_seed";

/** Everything the seeder writes, in an order the FKs tolerate. */
const TABLES = [
  "generated_outputs",
  "library_links",
  "library_views",
  "library_revisions",
  "wiki_article_categories",
  "wiki_categories",
  "analysis_runs",
  "code_chunks",
  "repo_files",
  "repos",
  "reference_doc_chunks",
  "reference_docs",
  "knowledge_feedback",
  "knowledge_entries",
  "work_item_links",
  "work_item_messages",
  "work_items",
  "project_area_map",
  "source_projects",
  "source_connections",
  "customer_facts",
  "customer_units",
  "customer_components",
  "customers",
  "components",
  "labels",
  "resolution_patterns",
  "artifacts",
  "preferences",
  "credentials",
  "team_members",
  "products",
  "users",
  "teams",
  "settings",
];

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "postgres",
  "tachy-postgres",
  "tachy-dev-postgres",
]);

/**
 * The tables the bulk load fills in volume. Their HNSW and GIN indexes come off
 * for the duration and are rebuilt from the catalog afterwards.
 */
const BULK_TABLES = [
  "knowledge_entries",
  "reference_docs",
  "reference_doc_chunks",
  "repo_files",
  "code_chunks",
];

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim().toLowerCase() === "yes";
}

/**
 * `seed` truncates, so the refusal has to be real. It will fill a virgin
 * database, and re-fill one it filled before, but it will not touch a
 * database holding rows it did not write.
 */
async function assertDevDatabase(opts: SeedOptions): Promise<void> {
  if (process.env.NODE_ENV === "production")
    throw new Error("refusing to seed with NODE_ENV=production");

  const [marker] =
    await sql`select key from settings where key = ${MARKER}`.catch(() => []);
  if (!marker) {
    const [{ count }] = await sql<{ count: string }[]>`
      select (
        (select count(*) from users) +
        (select count(*) from work_items) +
        (select count(*) from knowledge_entries)
      )::text as count
    `;
    if (Number(count) > 0)
      throw new Error(
        `refusing to seed: ${env.databaseUrl} holds ${count} rows this command did not create.\n` +
          `Seed a fresh database instead (docker compose down -v && up -d).`,
      );
  }

  if (opts.reset && !opts.yes) {
    const host = new URL(env.databaseUrl).hostname;
    if (!LOCAL_HOSTS.has(host))
      throw new Error(
        `refusing to --reset a non-local database (${host}). Pass --yes if you mean it.`,
      );
    const ok = await confirm(
      `This DELETES everything in ${env.databaseUrl}. Type 'yes' to continue: `,
    );
    if (!ok) throw new Error("aborted");
  }
}

/**
 * Incremental HNSW insertion is a graph traversal per row, and a GIN index
 * pays its posting-list maintenance on every one, so a bulk rebuild is far
 * cheaper than either. B-tree indexes stay: they are cheap to maintain and the
 * FK checks during the load use them.
 *
 * The DDL comes back out of the catalog rather than being restated here, so it
 * cannot drift from db/schema.sql.
 */
async function withoutBulkIndexes<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  // Qualified by schema: the test setup runs eight schemas side by side, each
  // holding indexes of these same names.
  const rows = await tx<{ indexname: string; indexdef: string }[]>`
    select indexname, indexdef from pg_indexes
    where schemaname = current_schema()
      and tablename = any(${BULK_TABLES})
      and indexdef ~* ' using (hnsw|gin) '
    order by indexname
  `;
  for (const row of rows) await tx.unsafe(`drop index ${row.indexname}`);

  const out = await fn();

  await tx.unsafe(`set local maintenance_work_mem = '512MB'`);
  for (const row of rows) await tx.unsafe(row.indexdef);
  return out;
}

/**
 * Elapsed time per generator. Until this existed the only number printed was
 * the total, so a seed that took an hour was something you waited through
 * rather than something you could point at.
 */
class Phases {
  readonly ms = new Map<string, number>();

  async run<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const at = Date.now();
    try {
      return await fn();
    } finally {
      this.ms.set(name, (this.ms.get(name) ?? 0) + (Date.now() - at));
    }
  }

  report(): void {
    const width = Math.max(...[...this.ms.keys()].map((k) => k.length));
    for (const [name, ms] of this.ms)
      console.log(`  ${name.padEnd(width)}  ${(ms / 1000).toFixed(1)}s`);
  }
}

export async function seed(opts: SeedOptions): Promise<void> {
  const v = SCALES[opts.scale];
  await assertDevDatabase(opts);

  const started = Date.now();
  const phases = new Phases();
  const mode = embedMode(opts.embed);
  const estimate = embedEstimateSeconds(mode, {
    knowledge_entry: v.knowledgeEntries,
    reference_doc_chunk: v.referenceChunks,
    code_chunk: v.codeChunks,
  });
  if (estimate > 60)
    console.log(
      `embedding ${mode === "all" ? "every corpus" : "the search corpora"} with the real model: ` +
        `about ${Math.round(estimate / 60)} min of CPU before the seed commits.` +
        (mode === "all"
          ? "\n  --embed=search skips code_chunks, which is most of that and only search_code reads."
          : ""),
    );
  const embed =
    mode === "none"
      ? syntheticEmbedder
      : await realEmbedder(mode, (kind, done) =>
          process.stderr.write(`\r  embedded ${done} ${kind}(s)   `),
        );

  // The bulk load is one transaction; the core helpers called afterwards open
  // their own connections and would deadlock against the truncate's locks.
  await sql.begin(async (tx: Tx) => {
    await tx.unsafe(`set local synchronous_commit = off`);
    if (opts.reset)
      await phases.run("truncate", () =>
        tx.unsafe(`truncate ${TABLES.join(", ")} restart identity cascade`),
      );

    const org = await phases.run("org", () => seedOrg(tx, v));
    const catalog = await phases.run("catalog", () =>
      seedCatalog(tx, v, org.products),
    );
    const sources = await phases.run("sources", () =>
      seedSources(
        tx,
        v,
        org.teams,
        org.products,
        catalog.customers,
        catalog.components,
      ),
    );

    let knowledge: Knowledge = { entries: [], docs: [] };
    const heavy = async () => {
      knowledge = await phases.run("knowledge", () =>
        seedKnowledge(
          tx,
          v,
          org.products,
          org.users,
          catalog.components,
          catalog.customers,
          sources.workItems,
          sources.projects,
          catalog.patterns,
          catalog.units,
          embed,
        ),
      );
      await phases.run("code", () =>
        seedCode(
          tx,
          v,
          org.products,
          catalog.components,
          catalog.customers,
          sources.projects,
          sources.connections,
          embed,
        ),
      );
    };
    // At small scale the rebuild costs more than the inserts it saves.
    if (opts.scale === "small") await heavy();
    else await phases.run("indexes", () => withoutBulkIndexes(tx, heavy));

    await phases.run("derive", async () => {
      await deriveProductAreas(tx);
      await supersede(tx);
    });
    await phases.run("activity", () =>
      seedActivity(tx, v, org.users, sources.workItems, org.artifacts),
    );
    await phases.run("library", () => seedLibrary(tx, v, knowledge, org.users));
    await phases.run("wiki", () => seedWiki(tx, org.products, org.users));
  });

  if (mode !== "none") process.stderr.write("\n");

  clearPermissionCache();
  await seedSettings();
  const credentials = await seedCredentials();

  await sql`
    insert into settings (key, value) values (${MARKER}, ${sql.json({ scale: opts.scale, at: new Date().toISOString() })})
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;

  await phases.run("count", () => report(opts, credentials));
  phases.report();
  console.log(
    `\nseeded '${opts.scale}' in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  banner(opts, credentials);
}

async function seedSettings(): Promise<void> {
  await setSetting("org_name", "Seeded Dev Org");
  await setSetting("deployment_profile", "support");
  await setSetting("redaction_global", false);
  await setSetting("agent_provider", "claude");
  await setSetting("agent_model", "claude-sonnet-5");
  await setSetting("agent_effort", "medium");
  await setSetting("allowed_models", ["claude-opus-5", "claude-sonnet-5"]);
}

/**
 * Through the real vault, not a hand-rolled bytea: this exercises the actual
 * AES-GCM path, the name rules and validateCredential's provider prefixes.
 */
async function seedCredentials(): Promise<number> {
  if (!secretsEnabled()) return 0;
  const [admin] = await sql<{ id: string }[]>`
    select id from users where email = ${ADMIN_EMAIL}
  `;
  if (!admin) return 0;

  const values: [string, string][] = [
    [AGENT_CREDENTIALS.claude, `sk-ant-api03-${"seeded".padEnd(95, "0")}`],
    [AGENT_CREDENTIALS.copilot, `ghu_${"seeded".padEnd(36, "0")}`],
  ];
  let n = 0;
  for (const [name, value] of values) {
    try {
      await setCredential(admin.id, "global", undefined, name, value);
      n++;
    } catch {
      // A provider may tighten its format rules; a dev credential is not
      // worth failing an otherwise good seed over.
    }
  }
  return n;
}

async function report(opts: SeedOptions, credentials: number): Promise<void> {
  const counts = await sql.unsafe<{ table: string; n: string }[]>(
    TABLES.map(
      (t) => `select '${t}' as table, count(*)::text as n from ${t}`,
    ).join(" union all "),
  );
  const width = Math.max(...TABLES.map((t) => t.length));
  for (const row of counts)
    console.log(`  ${row.table.padEnd(width)}  ${row.n.padStart(8)}`);
  console.log();
}

function banner(opts: SeedOptions, credentials: number): void {
  console.log(`  login: ${ADMIN_EMAIL} / ${DEV_PASSWORD}  (admin)`);
  console.log(
    `         ${MEMBER_EMAIL} / ${DEV_PASSWORD}  (member, used by k6)`,
  );
  if (!credentials)
    console.log(
      "  vault disabled — skipped credentials; set TACHY_SECRET_KEY to seed them",
    );
  const mode = embedMode(opts.embed);
  if (mode === "none")
    console.log(
      "  embeddings are SYNTHETIC: search exercises the query paths but its\n" +
        "  results are meaningless. Re-run with --embed for real vectors.",
    );
  else if (mode === "search")
    console.log(
      "  knowledge and reference vectors are real; code_chunks are synthetic,\n" +
        "  so search_code results are not meaningful. --embed=all covers those too.",
    );
}

/** `--embed` with no value means everything, as it did before the modes. */
function embedMode(embed: boolean | EmbedMode): EmbedMode {
  if (embed === true) return "all";
  if (embed === false) return "none";
  if (!EMBED_MODES.includes(embed))
    throw new Error(
      `unknown --embed '${embed}' (${EMBED_MODES.join("|")}, or bare for all)`,
    );
  return embed;
}
