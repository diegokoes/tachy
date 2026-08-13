import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createUser,
  createOutput,
  getOutput,
  listOutputs,
  deleteOutput,
  sweepExpiredOutputs,
  safeFilename,
} from "@tachy/core";
import { createApp } from "../packages/api/src/app";
import { loginCookie, resetData, sql } from "./helpers";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });
const login = (email: string) => loginCookie(app, email, "a-long-password");

const BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x11, 0x22]);

async function seedPeople() {
  const alice = await createUser({
    email: "alice@example.com",
    password: "a-long-password",
  });
  const bob = await createUser({
    email: "bob@example.com",
    password: "a-long-password",
  });
  return { alice, bob };
}

const make = (userId: string, over: Record<string, unknown> = {}) =>
  createOutput({
    userId,
    utility: "export_table",
    filename: "escalations.xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: BYTES,
    meta: { rows: 3, columns: 5 },
    ...over,
  });

beforeEach(resetData);

describe("output storage", () => {
  it("round-trips the bytes and records the size", async () => {
    const { alice } = await seedPeople();
    const meta = await make(alice.id);
    expect(meta.byte_size).toBe(BYTES.byteLength);
    expect(meta.meta).toEqual({ rows: 3, columns: 5 });

    const row = await getOutput(meta.id, alice.id);
    expect(Uint8Array.from(row.bytes)).toEqual(BYTES);
  });

  it("hides another user's output", async () => {
    const { alice, bob } = await seedPeople();
    const meta = await make(alice.id);
    await expect(getOutput(meta.id, bob.id)).rejects.toThrow(/not found/);
    expect(await listOutputs(bob.id)).toEqual([]);
    expect(await deleteOutput(meta.id, bob.id)).toBe(false);
    expect(await deleteOutput(meta.id, alice.id)).toBe(true);
  });

  it("stops serving an expired row and sweeps it away", async () => {
    const { alice } = await seedPeople();
    const meta = await make(alice.id);
    await sql`update generated_outputs set expires_at = now() - interval '1 hour' where id = ${meta.id}`;

    await expect(getOutput(meta.id, alice.id)).rejects.toThrow(/expired/);
    expect(await listOutputs(alice.id)).toEqual([]);
    expect(await sweepExpiredOutputs()).toBe(1);
    expect(
      await sql`select count(*)::int as n from generated_outputs`,
    ).toMatchObject([{ n: 0 }]);
  });

  it("never lets a path or control character into the filename", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("a/b:c*d?.xlsx")).toBe("b-c-d-.xlsx");
    expect(safeFilename("")).toBe("download");
  });
});

describe("outputs API", () => {
  it("downloads with the right headers and body", async () => {
    const { alice } = await seedPeople();
    const meta = await make(alice.id);
    const cookie = await login("alice@example.com");

    const list = await app.request("/api/outputs", { headers: { cookie } });
    expect(list.status).toBe(200);
    const rows = (await list.json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([meta.id]);
    expect(rows[0]).not.toHaveProperty("bytes");

    const res = await app.request(`/api/outputs/${meta.id}/download`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/spreadsheetml/);
    expect(res.headers.get("content-disposition")).toContain(
      'attachment; filename="escalations.xlsx"',
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
  });

  it("percent-encodes a non-ASCII filename alongside an ASCII fallback", async () => {
    const { alice } = await seedPeople();
    const meta = await make(alice.id, { filename: "rapport-café.csv" });
    const cookie = await login("alice@example.com");

    const res = await app.request(`/api/outputs/${meta.id}/download`, {
      headers: { cookie },
    });
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toContain('filename="rapport-caf_.csv"');
    expect(cd).toContain("filename*=UTF-8''rapport-caf%C3%A9.csv");
  });

  it("404s another user and rejects a caller with no account", async () => {
    const { alice } = await seedPeople();
    const meta = await make(alice.id);

    const bobCookie = await login("bob@example.com");
    const otherUser = await app.request(`/api/outputs/${meta.id}/download`, {
      headers: { cookie: bobCookie },
    });
    expect(otherUser.status).toBe(404);

    const anon = await app.request(`/api/outputs/${meta.id}/download`);
    expect(anon.status).toBe(403);
    expect((await anon.json()).error).toMatch(/no user account/);
  });

  it("deletes through the route", async () => {
    const { alice } = await seedPeople();
    const meta = await make(alice.id);
    const cookie = await login("alice@example.com");

    const del = await app.request(`/api/outputs/${meta.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true, deleted: true });
    expect(await listOutputs(alice.id)).toEqual([]);
  });
});
