import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "db", "schema.sql");
const migrationsDir = join(here, "..", "db", "migrations");
const fixturesPath = join(here, "fixtures.sql");

export default async function setup() {
  const container = await new PostgreSqlContainer(
    "pgvector/pgvector:pg16",
  ).start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;

  const sql = postgres(url, { onnotice: () => {} });
  await sql.unsafe(readFileSync(schemaPath, "utf8"));

  for (const f of readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const content = readFileSync(join(migrationsDir, f), "utf8");
    await sql.begin((tx) => tx.unsafe(content));
  }

  await sql.unsafe(readFileSync(fixturesPath, "utf8"));
  await sql.end();

  return async () => {
    await container.stop();
  };
}
