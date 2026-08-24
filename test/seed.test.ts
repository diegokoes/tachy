import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyPassword } from "@tachy/core";
import {
  seed,
  ADMIN_EMAIL,
  MEMBER_EMAIL,
  DEV_PASSWORD,
} from "../packages/cli/src/seed";
import { createApp } from "../packages/api/src/app";
import { sql, resetData, loginCookie, enableVault } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = readFileSync(join(here, "fixtures.sql"), "utf8");

/** Every base table, so a table added to schema.sql fails here until seeded. */
async function tables(): Promise<string[]> {
  const rows = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = current_schema() and table_type = 'BASE TABLE'
    order by table_name
  `;
  return rows.map((r) => r.table_name);
}

describe("seed", () => {
  beforeAll(async () => {
    enableVault();
    await resetData();
    await seed({ scale: "small", reset: true, yes: true, embed: false });
  });

  // resetData() is not enough to undo this: it deliberately keeps teams,
  // products and source_connections, because those are fixture rows every
  // other test builds on. The seeder truncates them and writes its own, so
  // afterwards the fixture 'tpd' and a seeded 'tpd' would sit in different
  // teams and every lookup by that slug would fail as ambiguous. Restore the
  // exact state global-setup left instead: empty, then fixtures.sql.
  afterAll(async () => {
    const names = (await tables()).join(", ");
    await sql.unsafe(`truncate ${names} restart identity cascade`);
    await sql.unsafe(fixtures);
  });

  it("fills every table in the schema", async () => {
    const empty: string[] = [];
    for (const t of await tables()) {
      const [{ n }] = await sql.unsafe<{ n: string }[]>(
        `select count(*)::text as n from ${t}`,
      );
      if (n === "0") empty.push(t);
    }
    expect(empty).toEqual([]);
  });

  it("is deterministic across runs", async () => {
    const before = await sql<{ id: string }[]>`
      select id from knowledge_entries order by id
    `;
    await seed({ scale: "small", reset: true, yes: true, embed: false });
    const after = await sql<{ id: string }[]>`
      select id from knowledge_entries order by id
    `;
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
  });

  it("gives the seeded users a working password", async () => {
    const [user] = await sql<{ password_hash: string }[]>`
      select password_hash from users where email = ${MEMBER_EMAIL}
    `;
    expect(await verifyPassword(DEV_PASSWORD, user.password_hash)).toBe(true);
  });

  it("derives product_area from the component hierarchy", async () => {
    const [{ n }] = await sql<{ n: string }[]>`
      select count(*)::text as n from knowledge_entries
      where product_area like '% / %'
    `;
    expect(Number(n)).toBeGreaterThan(0);
  });

  it("keeps the two work_item_links shapes disjoint", async () => {
    const [{ n }] = await sql<{ n: string }[]>`
      select count(*)::text as n from work_item_links
      where to_work_item_id is not null and to_external_id is not null
    `;
    expect(n).toBe("0");
  });

  it("serves the seeded data over the API", async () => {
    const app = createApp({ passwordAuth: true });
    const cookie = await loginCookie(app, MEMBER_EMAIL, DEV_PASSWORD);
    expect(cookie).not.toBe("");

    const list = await app.request("/api/knowledge?limit=5", {
      headers: { Cookie: cookie },
    });
    expect(list.status).toBe(200);
    expect((await list.json()).length).toBeGreaterThan(0);

    const search = await app.request(
      "/api/knowledge/search?q=printer+stops+mid-batch",
      { headers: { Cookie: cookie } },
    );
    expect(search.status).toBe(200);
  });

  it("seeds an admin who can reach admin-only routes", async () => {
    const app = createApp({ passwordAuth: true });
    const cookie = await loginCookie(app, ADMIN_EMAIL, DEV_PASSWORD);
    const res = await app.request("/api/system", {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
  });
});
