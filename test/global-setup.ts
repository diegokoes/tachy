import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { MAX_WORKERS, schemaFor } from "./parallel";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "db", "schema.sql");
const fixturesPath = join(here, "fixtures.sql");

export default async function setup() {
  const container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
    // Durability buys nothing for a throwaway container, and every fork holds
    // its own pool against this one server.
    .withCommand([
      "postgres",
      "-c",
      "fsync=off",
      "-c",
      "full_page_writes=off",
      "-c",
      "synchronous_commit=off",
      "-c",
      `max_connections=${50 + MAX_WORKERS * 25}`,
    ])
    .start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;

  const schemaSql = readFileSync(schemaPath, "utf8");
  const fixtureSql = readFileSync(fixturesPath, "utf8");

  const admin = postgres(url, { onnotice: () => {} });
  // Extensions are database-wide; the per-fork schemas share them.
  await admin.unsafe(
    "create extension if not exists pgcrypto;" +
      "create extension if not exists pg_trgm;" +
      "create extension if not exists vector;",
  );

  await Promise.all(
    Array.from({ length: MAX_WORKERS }, async (_, i) => {
      const schema = schemaFor(i + 1);
      await admin.unsafe(`create schema ${schema}`);
      const sql = postgres(url, {
        onnotice: () => {},
        max: 1,
        connection: { search_path: `${schema},public` },
      });
      await sql.unsafe(schemaSql);
      await sql.unsafe(fixtureSql);
      await sql.end();
    }),
  );
  await admin.end();

  return async () => {
    await container.stop();
  };
}
