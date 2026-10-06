import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@tachy/core/access";
import { clearSettingsCache, setSetting } from "@tachy/core/config";
import { createApp } from "../../packages/api/src/app";
import { json, loginCookie } from "../http";
import { resetData, sql, resetJobs } from "../database";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });
let cookie = "";

const call = (path: string, method = "GET", body?: unknown, who = cookie) =>
  app.request(`/api/jobs${path}`, {
    ...(body === undefined ? {} : json(body)),
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      Cookie: who,
    },
  });

beforeEach(async () => {
  await resetData();
  await resetJobs();
  await createUser({
    email: "ops@example.com",
    password: "a-long-password",
    role: "admin",
  });
  cookie = await loginCookie(app, "ops@example.com", "a-long-password");
});

describe("jobs API", () => {
  it("takes a window for the census, within a quarter", async () => {
    expect((await (await call("/census")).json()).days).toBe(14);
    const wide = await (await call("/census?days=90")).json();
    expect(wide.days).toBe(90);
    expect(wide.per_day).toHaveLength(90);
    expect((await call("/census?days=1")).status).toBe(400);
  });

  it("describes kinds with their params schema and the chat cap", async () => {
    const body = await (await call("/kinds")).json();
    const sync = body.kinds.find((k: any) => k.kind === "source.sync");
    expect(sync.params_schema.required).toEqual(["connection"]);
    expect(sync.connection).toBe("any");
    expect(body.class_chat_slots).toEqual({ light: 0, heavy: 3 });
  });

  it("creates, lists, runs, cancels and records a definition", async () => {
    const bad = await call("/definitions", "POST", {
      kind: "source.sync",
      name: "sync",
      params: {},
    });
    expect(bad.status).toBe(400);

    const created = await call("/definitions", "POST", {
      kind: "wiki.gaps",
      name: "gaps nightly",
      schedule: "0 2 * * *",
      timezone: "Europe/Berlin",
    });
    expect(created.status).toBe(201);
    const def = await created.json();

    const list = await (await call("/definitions")).json();
    expect(list).toHaveLength(1);
    expect(list[0].next_run).toMatch(/T/);
    expect(list[0].last_run).toBeNull();

    const run = await call(`/definitions/${def.id}/run`, "POST", {});
    expect(run.status).toBe(202);
    const { run_id } = await run.json();
    const runs = await (await call(`/runs?definition_id=${def.id}`)).json();
    expect(runs.map((r: any) => [r.id, r.trigger, r.status])).toEqual([
      [run_id, "manual", "queued"],
    ]);
    expect(
      (await (await call(`/runs/${run_id}/cancel`, "POST", {})).json()).status,
    ).toBe("cancelled");

    await call(`/definitions/${def.id}`, "PATCH", { enabled: false });
    const changes = await (await call(`/definitions/${def.id}/changes`)).json();
    expect(changes.map((ch: any) => [ch.action, ch.changed_by])).toEqual([
      ["updated", "ops@example.com"],
      ["created", "ops@example.com"],
    ]);

    const preview = await (
      await call("/schedule-preview", "POST", { schedule: "*/15 * * * *" })
    ).json();
    expect(preview.next).toHaveLength(5);
    expect(
      (await call("/schedule-preview", "POST", { schedule: "nope" })).status,
    ).toBe(400);
  });

  it("previews a schedule in the organisation's timezone when none is given", async () => {
    await setSetting("org_timezone", "Asia/Tokyo");
    try {
      expect((await (await call("/kinds")).json()).timezone).toBe("Asia/Tokyo");
      const next = async (body: Record<string, string>) =>
        (await (await call("/schedule-preview", "POST", body)).json())
          .next[0] as string;
      // 09:00 in Tokyo is midnight UTC.
      expect(await next({ schedule: "0 9 * * *" })).toMatch(/T00:00:00/);
      expect(await next({ schedule: "0 9 * * *", timezone: "UTC" })).toMatch(
        /T09:00:00/,
      );
    } finally {
      await sql`delete from settings where key = 'org_timezone'`;
      clearSettingsCache();
    }
  });

  it("starts a one-off run of a kind without a definition", async () => {
    const res = await call("/runs", "POST", {
      kind: "embeddings.backfill",
      params: { all: true },
    });
    expect(res.status).toBe(202);
    const { run_id } = await res.json();
    const run = await (await call(`/runs/${run_id}`)).json();
    expect(run).toMatchObject({
      kind: "embeddings.backfill",
      definition_id: null,
      params: { all: true },
    });
    expect((await call("/runs", "POST", { kind: "nope" })).status).toBe(400);
  });

  it("lists every run, with or without a definition, by kind, trigger and state", async () => {
    const def = await (
      await call("/definitions", "POST", { kind: "wiki.gaps", name: "gaps" })
    ).json();
    const { run_id: byDef } = await (
      await call(`/definitions/${def.id}/run`, "POST", {})
    ).json();
    const { run_id: adHoc } = await (
      await call("/runs", "POST", {
        kind: "embeddings.backfill",
        params: { all: false },
      })
    ).json();
    await call(`/runs/${byDef}/cancel`, "POST", {});

    const all = await (await call("/runs")).json();
    expect(all.map((r: any) => r.id)).toEqual([adHoc, byDef]);
    expect(all[1]).toMatchObject({
      definition_name: "gaps",
      requested_by_name: "ops@example.com",
    });
    expect(all[0].definition_name).toBeNull();

    const active = await (await call("/runs?active=true")).json();
    expect(active.map((r: any) => r.id)).toEqual([adHoc]);
    const gaps = await (await call("/runs?kind=wiki.gaps")).json();
    expect(gaps.map((r: any) => r.id)).toEqual([byDef]);
    const manual = await (await call("/runs?trigger=manual")).json();
    expect(manual).toHaveLength(2);
    const older = await (await call(`/runs?before=${adHoc}`)).json();
    expect(older.map((r: any) => r.id)).toEqual([byDef]);
  });

  it("reports every queue's backlog and the live workers", async () => {
    await call("/runs", "POST", { kind: "wiki.gaps", params: {} });
    const live = await (await call("/live")).json();
    expect(live.workers).toEqual([]);
    expect(live.queues.map((q: any) => q.name)).toEqual([
      "index",
      "embed",
      "testing",
      "sync",
      "flows",
      "maintenance",
    ]);
    expect(live.queues.at(-1)).toMatchObject({
      class: "light",
      cap: null,
      queued: 1,
      running: 0,
      workers: 0,
    });
  });

  it("is closed to members", async () => {
    await createUser({
      email: "dev@example.com",
      password: "a-long-password",
      role: "member",
    });
    const member = await loginCookie(app, "dev@example.com", "a-long-password");
    expect((await call("/definitions", "GET", undefined, member)).status).toBe(
      403,
    );
  });
});
