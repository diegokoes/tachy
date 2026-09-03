import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../packages/cli/src/seed";
import { resetData, sql } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = readFileSync(join(here, "fixtures.sql"), "utf8");

/**
 * Ratios, not fixed strings. What matters is that a column does not collapse
 * onto a handful of values — every one of these was a real collapse: one shared
 * code snippet across every chunk, `i % SYMPTOMS.length` titles, twelve message
 * bodies, and a chunk heading drawn independently of its own document. Asserting
 * the ratio lets the corpus grow without churning the test.
 */
async function distinctRatio(table: string, column: string): Promise<number> {
  const [row] = await sql.unsafe<{ d: string; n: string }[]>(
    `select count(distinct ${column})::text as d, count(*)::text as n from ${table}`,
  );
  expect(Number(row.n)).toBeGreaterThan(0);
  return Number(row.d) / Number(row.n);
}

describe("seeded data has variety", () => {
  beforeAll(async () => {
    await resetData();
    await seed({ scale: "small", reset: true, yes: true, embed: false });
  });

  // Same reasoning as seed.test.ts: the seeder truncates the fixture rows every
  // other file builds on, so put back exactly what global-setup left.
  afterAll(async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = current_schema() and table_type = 'BASE TABLE'
    `;
    await sql.unsafe(
      `truncate ${rows.map((r) => r.table_name).join(", ")} restart identity cascade`,
    );
    await sql.unsafe(fixtures);
    await sql.end();
  });

  it.each([
    ["code_chunks", "chunk_text", 0.9],
    ["reference_doc_chunks", "chunk_text", 0.9],
    ["knowledge_entries", "issue_summary", 0.9],
    ["reference_docs", "body", 0.9],
    ["work_items", "title", 0.5],
    ["work_item_messages", "body_text", 0.5],
  ] as const)("%s.%s is not one repeated value", async (table, col, floor) => {
    expect(await distinctRatio(table, col)).toBeGreaterThan(floor);
  });

  /** Only six rows at this scale, so a ratio says nothing — the count does. */
  it("draws an artifact body per artifact", async () => {
    const [row] = await sql<{ n: string }[]>`
      select count(distinct body)::text as n from artifacts
    `;
    expect(Number(row.n)).toBeGreaterThan(1);
  });

  /** rngFor("pref", 0) inside the loop gave all twelve users the same draw. */
  it("draws a per-user preference per user", async () => {
    const [row] = await sql<{ n: string }[]>`
      select count(distinct value)::text as n from preferences
      where scope = 'user' and key = 'agent_effort'
    `;
    expect(Number(row.n)).toBeGreaterThan(1);
  });

  it("anchors a reference chunk to the document it belongs to", async () => {
    const [row] = await sql<{ n: string }[]>`
      select count(*)::text as n
      from reference_doc_chunks c
      join reference_docs d on d.id = c.doc_id
      where position(d.title in c.chunk_text) = 0
    `;
    expect(row.n).toBe("0");
  });

  /**
   * Identical text embeds to an identical vector. Every code chunk shared one
   * snippet, so --embed produced 60k copies of one point and an HNSW graph with
   * nothing to traverse. Synthetic vectors are keyed to the row rather than the
   * text, so this checks the spread the index actually sees.
   */
  it("spreads code-chunk vectors rather than stacking them", async () => {
    const [row] = await sql<{ worst: number }[]>`
      with sample as (
        select embedding from code_chunks where embedding is not null limit 200
      )
      select max(1 - (a.embedding <=> b.embedding)) as worst
      from sample a, sample b
      where a.embedding <> b.embedding
    `;
    expect(row.worst).toBeLessThan(0.999);
  });

  it("gives every product's wiki its own prose", async () => {
    expect(await distinctRatio("reference_docs", "body")).toBeGreaterThan(0.9);
  });
});
