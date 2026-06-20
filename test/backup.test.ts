import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetData, sql } from "./helpers";

// Backup/restore shell out to the Postgres client tools; only run the round-trip
// where they're installed (CI installs postgresql-client; skipped otherwise).
const hasPgTools = spawnSync("pg_dump", ["--version"]).status === 0;
const url = () => process.env.DATABASE_URL!;

describe.skipIf(!hasPgTools)("backup / restore round-trip", () => {
  beforeEach(resetData);
  afterAll(() => sql.end());

  it("dumps and restores knowledge entries", async () => {
    await sql`insert into knowledge_entries (status, issue_summary) values ('approved', 'sentinel entry')`;

    const dir = mkdtempSync(join(tmpdir(), "tachy-bk-"));
    const file = join(dir, "t.dump");
    expect(spawnSync("pg_dump", ["-Fc", "-d", url(), "-f", file]).status).toBe(0);

    await sql`delete from knowledge_entries`;
    expect((await sql`select count(*)::int n from knowledge_entries`)[0].n).toBe(0);

    expect(spawnSync("pg_restore", ["--clean", "--if-exists", "-d", url(), file]).status).toBe(0);
    const [row] = await sql`select issue_summary from knowledge_entries`;
    expect(row.issue_summary).toBe("sentinel entry");
  });
});
