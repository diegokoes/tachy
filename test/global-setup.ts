import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "db", "schema.sql");
const fixturesPath = join(here, "fixtures.sql");

// Starts one ephemeral Postgres for the whole test run and applies the schema.
// Uses the pgvector image so Phase 3's `vector` extension is available too; it
// is based on the official postgres image, so pg_trgm + pgcrypto are present.
// DATABASE_URL is set here, before vitest forks its (single) worker, so the
// core `sql` client picks it up when it is first imported.
export default async function setup() {
  const container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;

  const sql = postgres(url, { onnotice: () => {} });
  await sql.unsafe(readFileSync(schemaPath, "utf8"));
  // schema.sql itself ships with no seed data; tests need deterministic
  // teams/products/a source connection, so apply this fixture on top.
  await sql.unsafe(readFileSync(fixturesPath, "utf8"));
  await sql.end();

  return async () => {
    await container.stop();
  };
}
