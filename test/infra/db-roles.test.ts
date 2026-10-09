import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sql } from "@tachy/core/infra";

const rolesSql = readFileSync(
  join(import.meta.dirname, "..", "..", "db", "roles.sql"),
  "utf8",
);

/** Runs `body` as `role` and always rolls back. */
async function asRole(role: string, body: (tx: typeof sql) => Promise<void>) {
  await sql
    .begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      await body(tx as unknown as typeof sql);
      throw new Error("rollback");
    })
    .catch((err) => {
      if (err.message !== "rollback") throw err;
    });
}

describe("database roles", () => {
  it("applies twice without error", async () => {
    await sql.unsafe(rolesSql);
    await sql.unsafe(rolesSql);
  });

  it("lets tachy_app read and write application tables", async () => {
    await asRole("tachy_app", async (tx) => {
      await tx`insert into teams (slug, name) values ('roles-test', 'Roles')`;
      const [row] = await tx`select name from teams where slug = 'roles-test'`;
      expect(row.name).toBe("Roles");
    });
  });

  it("refuses DDL and server-side programs to tachy_app", async () => {
    await expect(
      asRole("tachy_app", (tx) => tx`create table roles_probe (id int)`.then()),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole("tachy_app", (tx) =>
        tx.unsafe("copy teams to program 'true'").then(),
      ),
    ).rejects.toThrow(
      /permission denied|must be superuser|pg_execute_server_program/,
    );
  });

  it("gives tachy_backup read access only", async () => {
    await asRole("tachy_backup", async (tx) => {
      await tx`select count(*) from teams`;
    });
    await expect(
      asRole("tachy_backup", (tx) =>
        tx`insert into teams (slug, name) values ('nope', 'Nope')`.then(),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("lets tachy_watch count sessions and read no table", async () => {
    await asRole("tachy_watch", async (tx) => {
      const [row] = await tx`
        select count(*)::int as n from pg_stat_activity where query is not null
      `;
      expect(row.n).toBeGreaterThan(0);
    });
    // Without usage on the schema a table is not even visible.
    await expect(
      asRole("tachy_watch", (tx) => tx`select count(*) from teams`.then()),
    ).rejects.toThrow(/permission denied|does not exist/);
  });

  it("keeps tachy_app from changing or removing the audit trail", async () => {
    await asRole("tachy_app", async (tx) => {
      await tx`insert into audit_events (actor, action) values ('api', 'setup')`;
      expect((await tx`select count(*)::int as n from audit_events`)[0].n).toBe(
        1,
      );
    });
    for (const statement of [
      "update audit_events set action = 'login'",
      "delete from audit_events",
      "truncate audit_events",
    ])
      await expect(
        asRole("tachy_app", (tx) => tx.unsafe(statement).then()),
      ).rejects.toThrow(/permission denied/);
  });

  it("gives tachy_mcp what the chat tools use", async () => {
    await asRole("tachy_mcp", async (tx) => {
      const [user] = await tx`
        insert into users (email, display_name) values ('tool@example.com', 'Tool')
        on conflict (email) do update set
          display_name = coalesce(excluded.display_name, users.display_name)
        returning id
      `;
      const [seen] = await tx`
        select u.role, u.disabled from users u where u.id = ${user.id}
      `;
      expect(seen.role).toBe("member");
      await tx`insert into teams (slug, name) values ('mcp-test', 'Mcp')`;
      await tx`
        insert into audit_events (actor_user_id, actor_email, actor, action)
        values (${user.id}, (select email from users where id = ${user.id}),
                'mcp', 'catalog_add')
      `;
    });
  });

  it.each([
    "select password_hash from users",
    "select session_epoch from users",
    "select * from users",
    "update users set role = 'admin'",
    "update users set password_hash = 'x'",
    "delete from users",
    "select count(*) from credentials",
    "insert into credentials (scope, name) values ('global', 'x')",
    "select count(*) from api_tokens",
    "select count(*) from audit_events",
    "delete from audit_events",
    "create table mcp_probe (id int)",
  ])("refuses tachy_mcp: %s", async (statement) => {
    await expect(
      asRole("tachy_mcp", (tx) => tx.unsafe(statement).then()),
    ).rejects.toThrow(/permission denied/);
  });
});
