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

/** Rows built, embedded and inserted per pass. */
const WINDOW = 2_000;

/**
 * Build and insert a table a window at a time, so `fill` has a batch of rows to
 * work on between building them and writing them. That hook is the whole point:
 * it is where the embedder runs the model over a window's text at once, instead
 * of once per row inside the build loop.
 *
 * Not a memory optimisation — measured against building the array whole, peak
 * heap and wall time are the same, because `insertRows` already chunks and V8
 * reclaims the rows behind it.
 *
 * `build` is called with the row's own index, so ids stay derived from that
 * index and a window boundary cannot move them.
 */
export async function insertWindowed(
  tx: Tx,
  table: string,
  columns: string[],
  count: number,
  build: (i: number) => Record<string, unknown>,
  opts: {
    window?: number;
    fill?: (rows: Record<string, unknown>[], offset: number) => Promise<void>;
  } = {},
): Promise<number> {
  const size = opts.window ?? WINDOW;
  let written = 0;
  for (let start = 0; start < count; start += size) {
    const end = Math.min(start + size, count);
    const rows: Record<string, unknown>[] = [];
    for (let i = start; i < end; i++) rows.push(build(i));
    if (opts.fill) await opts.fill(rows, start);
    written += await insertRows(tx, table, columns, rows);
  }
  return written;
}
