import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@tachy/core";
import { createApp } from "../packages/api/src/app";
import { json, loginCookie, resetData, sql } from "./helpers";

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
  await sql`truncate job_definition_changes, job_runs, job_definitions`;
  await createUser({
    email: "ops@example.com",
    password: "a-long-password",
    role: "admin",
  });
  cookie = await loginCookie(app, "ops@example.com", "a-long-password");
});

describe("jobs API", () => {
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
