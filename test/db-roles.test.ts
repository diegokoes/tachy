import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sql } from "@tachy/core";

const rolesSql = readFileSync(
  join(import.meta.dirname, "..", "db", "roles.sql"),
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
});
