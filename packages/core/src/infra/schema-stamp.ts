import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "./db";

export type SchemaStampStatus = "match" | "mismatch" | "unstamped";

let expected: string | null | undefined;

function expectedHash(): string | null {
  if (expected !== undefined) return expected;
  try {
    const body = readFileSync(join(process.cwd(), "db/schema.sql"));
    expected = createHash("sha256").update(body).digest("hex");
  } catch {
    expected = null;
  }
  return expected;
}

/**
 * Whether the database was built from the same `db/schema.sql` this process
 * ships with. `unstamped` covers a database from before the stamp existed, or
 * a process running without the file; neither is a reason to refuse traffic.
 */
export async function schemaStampStatus(): Promise<SchemaStampStatus> {
  const want = expectedHash();
  if (!want) return "unstamped";
  const [row] = await sql<{ schema_sha256: string }[]>`
    select schema_sha256 from schema_meta where id
  `;
  if (!row) return "unstamped";
  return row.schema_sha256 === want ? "match" : "mismatch";
}
