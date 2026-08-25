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
  supersede,
  syntheticVector,
} from "./knowledge";
import { seedCode } from "./code";
import { seedActivity } from "./activity";

export { SCALE_NAMES, type ScaleName } from "./scale";
export { ADMIN_EMAIL, MEMBER_EMAIL, DEV_PASSWORD } from "./org";

export interface SeedOptions {
  scale: ScaleName;
  reset: boolean;
  yes: boolean;
  embed: boolean;
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

const HNSW_INDEXES = [
  "knowledge_embedding_idx",
  "reference_doc_chunks_embedding_idx",
  "code_chunks_embedding_idx",
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
 * Incremental HNSW insertion is a graph traversal per row, so a bulk rebuild
 * is far cheaper. The DDL comes back out of the catalog rather than being
 * restated here, so it cannot drift from db/schema.sql.
 */
async function withoutHnsw<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  const defs: string[] = [];
  for (const name of HNSW_INDEXES) {
    // Qualified by schema: the test setup runs eight schemas side by side,
    // each holding an index of this same name.
    const [row] = await tx<{ indexdef: string }[]>`
      select indexdef from pg_indexes
      where indexname = ${name} and schemaname = current_schema()
    `;
    if (!row) continue;
    defs.push(row.indexdef);
    await tx.unsafe(`drop index ${name}`);
  }
  const out = await fn();
  await tx.unsafe(`set local maintenance_work_mem = '512MB'`);
  for (const def of defs) await tx.unsafe(def);
  return out;
}

export async function seed(opts: SeedOptions): Promise<void> {
  const v = SCALES[opts.scale];
  await assertDevDatabase(opts);

  const started = Date.now();
  const embed = opts.embed ? await realEmbedder() : syntheticVector;

  // The bulk load is one transaction; the core helpers called afterwards open
  // their own connections and would deadlock against the truncate's locks.
  await sql.begin(async (tx: Tx) => {
    await tx.unsafe(`set local synchronous_commit = off`);
    if (opts.reset)
      await tx.unsafe(`truncate ${TABLES.join(", ")} restart identity cascade`);

    const org = await seedOrg(tx, v);
    const catalog = await seedCatalog(tx, v, org.products);
    const sources = await seedSources(
      tx,
      v,
      org.teams,
      org.products,
      catalog.customers,
      catalog.components,
    );

    const heavy = async () => {
      await seedKnowledge(
        tx,
        v,
        org.products,
        org.users,
        catalog.components,
        catalog.customers,
        sources.workItems,
        sources.projects,
        catalog.patterns,
        embed,
      );
      await seedCode(
        tx,
        v,
        org.products,
        catalog.components,
        catalog.customers,
        sources.projects,
        sources.connections,
        embed,
      );
    };
    // At small scale the rebuild costs more than the inserts it saves.
    if (opts.scale === "small") await heavy();
    else await withoutHnsw(tx, heavy);

    await deriveProductAreas(tx);
    await supersede(tx);
    await seedActivity(tx, v, org.users, sources.workItems, org.artifacts);
  });

  clearPermissionCache();
  await seedSettings();
  const credentials = await seedCredentials();

  await sql`
    insert into settings (key, value) values (${MARKER}, ${sql.json({ scale: opts.scale, at: new Date().toISOString() })})
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;

  await report(opts, Date.now() - started, credentials);
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

async function realEmbedder(): Promise<
  (kind: string, i: number, text: string) => Promise<string>
> {
  const { embedPassage } = await import("@tachy/core");
  return async (_kind, _i, text) => `[${(await embedPassage(text)).join(",")}]`;
}

async function report(
  opts: SeedOptions,
  ms: number,
  credentials: number,
): Promise<void> {
  const counts = await sql.unsafe<{ table: string; n: string }[]>(
    TABLES.map(
      (t) => `select '${t}' as table, count(*)::text as n from ${t}`,
    ).join(" union all "),
  );
  const width = Math.max(...TABLES.map((t) => t.length));
  for (const row of counts)
    console.log(`  ${row.table.padEnd(width)}  ${row.n.padStart(8)}`);

  console.log(`\nseeded '${opts.scale}' in ${(ms / 1000).toFixed(1)}s`);
  console.log(`  login: ${ADMIN_EMAIL} / ${DEV_PASSWORD}  (admin)`);
  console.log(
    `         ${MEMBER_EMAIL} / ${DEV_PASSWORD}  (member, used by k6)`,
  );
  if (!credentials)
    console.log(
      "  vault disabled — skipped credentials; set TACHY_SECRET_KEY to seed them",
    );
  if (!opts.embed)
    console.log(
      "  embeddings are SYNTHETIC: search exercises the query paths but its\n" +
        "  results are meaningless. Re-run with --embed for real vectors.",
    );
}
