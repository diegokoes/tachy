import type { Db } from "@tachy/core";

export type Tx = Db;

/** Postgres caps a statement at 65535 bind parameters; stay well under. */
const PARAM_BUDGET = 60_000;
const MAX_ROWS = 1_000;

/**
 * Chunked multi-row INSERT. The statement is built by hand rather than through
 * postgres.js's row helper: the helper's inferred key type does not survive a
 * column list that is only known as `string[]`, and the placeholders are what
 * bound the chunk size anyway.
 */
export async function insertRows(
  tx: Tx,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
): Promise<number> {
  if (!rows.length) return 0;
  const chunk = Math.max(
    1,
    Math.min(MAX_ROWS, Math.floor(PARAM_BUDGET / columns.length)),
  );
  const cols = columns.join(", ");

  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params: unknown[] = [];
    const tuples = slice.map((row) => {
      const placeholders = columns.map((c) => {
        params.push(row[c] ?? null);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await tx.unsafe(
      `insert into ${table} (${cols}) values ${tuples.join(", ")}`,
      params as never[],
    );
  }
  return rows.length;
}
