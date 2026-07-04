import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "./helpers";

afterAll(() => sql.end());

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "db", "migrations");

// global-setup already applied schema.sql + every migration once; re-applying
// here proves each migration is idempotent (the upgrade contract for existing
// deployments, where `tachy migrate` may run repeatedly).
describe("db migrations", () => {
  it("re-apply cleanly against an already-migrated database", async () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const content = readFileSync(join(dir, f), "utf8");
      await sql.begin((tx) => tx.unsafe(content));
    }
    // Spot-check the migrated shape: new columns + widened status CHECK.
    const cols = await sql`
      select column_name from information_schema.columns
      where table_name = 'knowledge_entries' and column_name in ('component_id', 'superseded_by')
    `;
    expect(cols).toHaveLength(2);
    await expect(
      sql`insert into knowledge_entries (issue_summary, status) values ('x', 'deprecated')`,
    ).resolves.toBeDefined();
    await sql`delete from knowledge_entries where issue_summary = 'x' and status = 'deprecated'`;
  });
});
