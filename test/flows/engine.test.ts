import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createFlow,
  createUser,
  defineFlowAction,
  evaluateCondition,
  getFlow,
  enqueueRun,
  getJobKind,
  ingestWorkItem,
  interpolate,
  itemTriggers,
  listFlowRuns,
  registerCoreJobs,
  runFlow,
  setTeamMember,
  updateFlow,
  validateGraph,
  type FlowGraph,
  type RawWorkItem,
} from "@tachy/core";
import { createApp } from "../../packages/api/src/app";
import {
  json,
  loginCookie,
  resetData,
  resetJobs,
  seededFreshdeskConnId,
  sql,
} from "../helpers";

afterAll(() => sql.end());

const written: unknown[] = [];

defineFlowAction({
  key: "test.echo",
  title: "Echo",
  category: "read",
  writes: false,
  params: z.object({
    say: z.string().default("{{item.title}}"),
    times: z.number().int().default(1),
  }),
  output: z.object({ said: z.string(), count: z.number() }),
  run: async (_ctx, p) => ({ said: p.say.repeat(p.times), count: p.times }),
});

defineFlowAction({
  key: "test.write",
  title: "Write",
  category: "update",
  writes: true,
  params: z.object({ body: z.string() }),
  output: z.object({ ok: z.boolean() }),
  run: async (_ctx, p) => {
    if (p.body === "boom") throw new Error("the source said no");
    written.push(p.body);
    return { ok: true };
  },
});

const rawItem = (over: Partial<RawWorkItem> = {}): RawWorkItem => ({
  externalId: "7001",
  kind: "ticket",
  title: "Scanner offline",
  status: "2",
  groupKey: "48000641379",
  raw: { id: 7001, tags: ["bug", "Plant-3"], company_id: 42 },
  messages: [],
  sourceUpdatedAt: "2026-09-01T10:00:00Z",
  ...over,
});

const noop = {
  signal: new AbortController().signal,
  log: () => {},
  enqueue: async () => null,
};

describe("templates and conditions", () => {
  const ctx = {
    item: { title: "Scanner offline", tags: ["bug", "Plant-3"], n: 3 },
    steps: { s1: { count: 2, rows: [{ a: 1 }] } },
  };

  it("keeps a lone token's type and writes tokens in text as text", () => {
    expect(interpolate("{{steps.s1.count}}", ctx)).toBe(2);
    expect(interpolate("{{ item.tags }}", ctx)).toEqual(["bug", "Plant-3"]);
    expect(interpolate("#{{item.title}}: {{steps.s1.count}}", ctx)).toBe(
      "#Scanner offline: 2",
    );
    expect(interpolate({ a: ["{{missing.x}}", "x{{missing}}"] }, ctx)).toEqual({
      a: [undefined, "x"],
    });
  });

  it("matches text without case and a list by any of its values", () => {
    const holds = (c: Parameters<typeof evaluateCondition>[0]) =>
      evaluateCondition(c, ctx);
    expect(
      holds({ field: "item.tags", op: "contains", value: "plant-3" }),
    ).toBe(true);
    expect(holds({ field: "item.tags", op: "eq", value: "BUG" })).toBe(true);
    expect(holds({ field: "item.title", op: "matches", value: "^scan" })).toBe(
      true,
    );
    expect(holds({ field: "item.title", op: "matches", value: "(" })).toBe(
      false,
    );
    expect(holds({ field: "item.n", op: "gt", value: "2" })).toBe(true);
    expect(holds({ field: "item.none", op: "exists" })).toBe(false);
    expect(
      holds({
        all: [
          { field: "item.n", op: "in", value: [1, 3] },
          { not: { field: "item.title", op: "contains", value: "printer" } },
        ],
      }),
    ).toBe(true);
  });
});

describe("validateGraph", () => {
  const act = (id: string, params: Record<string, unknown> = { say: "x" }) => ({
    id,
    kind: "action",
    action: "test.echo",
    params,
  });

  it("lets templates through where a type is only known at run time", () => {
    expect(() =>
      validateGraph({
        triggers: [{ id: "t", kind: "manual" }],
        steps: [act("a"), act("b", { say: "x", times: "{{steps.a.count}}" })],
      }),
    ).not.toThrow();
    expect(() =>
      validateGraph({ steps: [act("b", { say: "x", times: "two" })] }),
    ).toThrow(/step 'b': times/);
  });

  it("wants an if to end its list, known actions and unique ids", () => {
    const branch = {
      id: "i",
      kind: "if",
      when: { field: "item.status", op: "eq", value: "2" },
      then: [],
      else: [],
    };
    expect(() => validateGraph({ steps: [branch, act("a")] })).toThrow(
      /has to end its list/,
    );
    expect(() =>
      validateGraph({
        steps: [{ id: "x", kind: "action", action: "nope", params: {} }],
      }),
    ).toThrow(/unknown action/);
    expect(() => validateGraph({ steps: [act("a"), act("a")] })).toThrow(
      /used twice/,
    );
    expect(() =>
      validateGraph({
        triggers: [{ id: "s", kind: "schedule", params: { cron: "nope" } }],
      }),
    ).toThrow(/schedule/);
  });
});

describe("runFlow", () => {
  beforeEach(async () => {
    await resetData();
    written.length = 0;
  });

  async function flowWith(steps: unknown[]) {
    return createFlow(
      {
        name: `f${Math.random()}`,
        team_id: null,
        enabled: true,
        graph: { triggers: [{ id: "m", kind: "manual" }], steps },
      },
      null,
    );
  }

  it("feeds each step what earlier ones returned and takes the branch that holds", async () => {
    const item = await ingestWorkItem(await seededFreshdeskConnId(), rawItem());
    const flow = await flowWith([
      {
        id: "a",
        kind: "action",
        action: "test.echo",
        params: { say: "{{item.title}}" },
      },
      {
        id: "branch",
        kind: "if",
        when: { field: "item.tags", op: "contains", value: "bug" },
        then: [
          {
            id: "yes",
            kind: "action",
            action: "test.write",
            params: { body: "saw {{steps.a.said}}" },
          },
        ],
        else: [
          {
            id: "no",
            kind: "action",
            action: "test.write",
            params: { body: "no" },
          },
        ],
      },
    ]);
    const res = await runFlow({
      ...noop,
      flow,
      triggerId: "m",
      workItemId: item.id,
      dryRun: false,
      jobRunId: null,
    });
    expect(res.status).toBe("succeeded");
    expect(written).toEqual(["saw Scanner offline"]);
    const [run] = await listFlowRuns(flow.id);
    expect(run.steps.map((s) => [s.step_id, s.status, s.held])).toEqual([
      ["a", "ok", undefined],
      ["branch", "ok", true],
      ["yes", "ok", undefined],
    ]);
  });

  it("fills a param's template default from the item", async () => {
    const item = await ingestWorkItem(await seededFreshdeskConnId(), rawItem());
    const flow = await flowWith([
      { id: "a", kind: "action", action: "test.echo", params: {} },
    ]);
    await runFlow({
      ...noop,
      flow,
      triggerId: "m",
      workItemId: item.id,
      dryRun: false,
      jobRunId: null,
    });
    const [run] = await listFlowRuns(flow.id);
    expect(run.steps[0].output).toEqual({ said: "Scanner offline", count: 1 });
  });

  it("stops at a filter that does not hold, and writes nothing on a dry run", async () => {
    const item = await ingestWorkItem(await seededFreshdeskConnId(), rawItem());
    const flow = await flowWith([
      { id: "w", kind: "action", action: "test.write", params: { body: "hi" } },
      {
        id: "f",
        kind: "filter",
        when: { field: "item.status", op: "eq", value: "5" },
      },
      {
        id: "after",
        kind: "action",
        action: "test.write",
        params: { body: "never" },
      },
    ]);
    const res = await runFlow({
      ...noop,
      flow,
      triggerId: "m",
      workItemId: item.id,
      dryRun: true,
      jobRunId: null,
    });
    expect(res.status).toBe("stopped");
    expect(written).toEqual([]);
    const [run] = await listFlowRuns(flow.id);
    expect(run.steps.map((s) => s.status)).toEqual(["dry", "ok"]);
    expect(run.steps[0].output).toEqual({ would: { body: "hi" } });
  });

  it("fails the run on a failed step and keeps the trace up to it", async () => {
    const flow = await flowWith([
      { id: "a", kind: "action", action: "test.echo", params: { say: "x" } },
      {
        id: "w",
        kind: "action",
        action: "test.write",
        params: { body: "boom" },
      },
    ]);
    await expect(
      runFlow({
        ...noop,
        flow,
        triggerId: "m",
        workItemId: null,
        dryRun: false,
        jobRunId: null,
      }),
    ).rejects.toThrow(/step 'w': the source said no/);
    const [run] = await listFlowRuns(flow.id);
    expect(run.status).toBe("failed");
    expect(run.steps.map((s) => s.status)).toEqual(["ok", "failed"]);
  });
});

describe("triggers", () => {
  beforeEach(async () => {
    await resetData();
    await resetJobs();
  });

  it("queues a run for a new or changed item that passes the trigger's condition", async () => {
    const graph: FlowGraph = {
      triggers: [
        {
          id: "synced",
          kind: "item.synced",
          params: { connection: "test-freshdesk" },
          where: { field: "item.raw.company_id", op: "eq", value: "42" },
        },
      ],
      steps: [
        { id: "a", kind: "action", action: "test.echo", params: { say: "x" } },
      ],
    };
    const flow = await createFlow(
      { name: "on sync", team_id: null, enabled: true, graph },
      null,
    );
    const connId = await seededFreshdeskConnId();
    const fire = await itemTriggers("test-freshdesk");
    expect(fire).not.toBeNull();

    const first = await ingestWorkItem(connId, rawItem());
    expect(first).toMatchObject({ inserted: true, changed: true });
    await fire!(first.id, "created");

    const again = await ingestWorkItem(connId, rawItem());
    expect(again).toMatchObject({ inserted: false, changed: false });

    const other = await ingestWorkItem(
      connId,
      rawItem({ externalId: "7002", raw: { id: 7002, company_id: 9 } }),
    );
    await fire!(other.id, "created");

    const runs = await sql`select params from job_runs where kind = 'flow.run'`;
    expect(runs.map((r) => r.params)).toEqual([
      {
        flow_id: flow.id,
        trigger_id: "synced",
        work_item_id: first.id,
        dry_run: false,
      },
    ]);
    expect(await itemTriggers("other-connection")).toBeNull();
  });

  it("keeps one job definition per schedule trigger, paused with the flow", async () => {
    const schedule = {
      id: "nightly",
      kind: "schedule" as const,
      params: { cron: "0 2 * * *", timezone: "Europe/Berlin" },
    };
    const flow = await createFlow(
      {
        name: "sweep",
        team_id: null,
        enabled: true,
        graph: { triggers: [schedule], steps: [] },
      },
      null,
    );
    let defs = await sql`select * from job_definitions where kind = 'flow.run'`;
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      schedule: "0 2 * * *",
      timezone: "Europe/Berlin",
      enabled: true,
      params: { flow_id: flow.id, trigger_id: "nightly" },
    });

    await updateFlow(
      flow.id,
      {
        name: "sweep",
        team_id: null,
        enabled: false,
        graph: { triggers: [schedule], steps: [] },
      },
      null,
    );
    defs =
      await sql`select enabled from job_definitions where kind = 'flow.run'`;
    expect(defs[0].enabled).toBe(false);

    await updateFlow(
      flow.id,
      { name: "sweep", team_id: null, enabled: false, graph: { steps: [] } },
      null,
    );
    defs = await sql`select 1 from job_definitions where kind = 'flow.run'`;
    expect(defs).toHaveLength(0);
    expect((await getFlow(flow.id)).graph.triggers).toEqual([]);
  });
});

describe("/api/flows", () => {
  const app = createApp({ passwordAuth: true });
  let admin = "";
  let teamAdmin = "";
  let member = "";

  const call = (path: string, who: string, method = "GET", body?: unknown) =>
    app.request(`/api/flows${path}`, {
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
    for (const [email, role] of [
      ["ops@example.com", "admin"],
      ["lead@example.com", "member"],
      ["dev@example.com", "member"],
    ] as const)
      await createUser({ email, password: "a-long-password", role });
    await setTeamMember("test-team", "lead@example.com", "admin");
    await setTeamMember("test-team", "dev@example.com", "member");
    admin = await loginCookie(app, "ops@example.com", "a-long-password");
    teamAdmin = await loginCookie(app, "lead@example.com", "a-long-password");
    member = await loginCookie(app, "dev@example.com", "a-long-password");
  });

  const body = (team: string | null) => ({
    name: "triage",
    team,
    enabled: false,
    graph: {
      triggers: [{ id: "m", kind: "manual" }],
      steps: [
        { id: "a", kind: "action", action: "knowledge.search", params: {} },
      ],
    },
  });

  it("lets a team's admins build its flows, and only app admins global ones", async () => {
    expect((await call("", member, "POST", body("test-team"))).status).toBe(
      403,
    );
    expect((await call("", teamAdmin, "POST", body(null))).status).toBe(403);
    const made = await call("", teamAdmin, "POST", body("test-team"));
    expect(made.status).toBe(201);
    const flow = await made.json();
    expect(flow).toMatchObject({
      team_slug: "test-team",
      run_as_email: "lead@example.com",
    });
    expect((await call("", admin, "POST", body(null))).status).toBe(201);

    const seen = await (await call("", member)).json();
    expect(seen.map((f: { id: string }) => f.id)).toEqual([flow.id]);
  });

  it("describes the library and reads option lists from the items", async () => {
    const actions = await (await call("/actions", teamAdmin)).json();
    const note = actions.find(
      (a: { key: string }) => a.key === "item.post_note",
    );
    expect(note).toMatchObject({
      category: "update",
      writes: true,
      source: "freshdesk",
    });
    const create = actions.find(
      (a: { key: string }) => a.key === "ado.create_item",
    );
    expect(create.params_schema.properties.type).toMatchObject({
      "x-options": "ado.types",
      "x-depends-on": ["project"],
    });
    expect((await call("/actions", member)).status).toBe(403);

    await ingestWorkItem(await seededFreshdeskConnId(), rawItem());
    const fields = await (
      await call("/options/item.fields?connection=test-freshdesk", teamAdmin)
    ).json();
    expect(fields.map((f: { value: string }) => f.value)).toEqual(
      expect.arrayContaining([
        "item.title",
        "item.raw.company_id",
        "item.raw.tags",
      ]),
    );
    const values = await (
      await call(
        "/options/item.values?connection=test-freshdesk&field=item.tags",
        teamAdmin,
      )
    ).json();
    expect(values.map((v: { value: string }) => v.value)).toEqual([
      "bug",
      "Plant-3",
    ]);
  });

  it("serves tachy's own lists, and says what a list still needs", async () => {
    await ingestWorkItem(await seededFreshdeskConnId(), rawItem());
    const read = async (path: string) =>
      (await call(`/options/${path}`, teamAdmin)).json();
    expect(await read("connections?source_type=freshdesk")).toContainEqual({
      value: "test-freshdesk",
      label: "test-freshdesk",
      hint: "freshdesk",
    });
    expect(
      (await read("teams")).map((t: { value: string }) => t.value),
    ).toContain("test-team");
    expect(await read("work_items?q=7001")).toEqual([
      expect.objectContaining({ label: "#7001 Scanner offline" }),
    ]);
    expect(Array.isArray(await read("job.kinds"))).toBe(true);
    expect(Array.isArray(await read("products"))).toBe(true);
    const missing = await call("/options/item.values", teamAdmin);
    expect(missing.status).toBe(400);
    expect((await call("/options/nope", teamAdmin)).status).toBe(400);
  });

  it("queues a dry run on an item by default", async () => {
    const flow = await (await call("", admin, "POST", body(null))).json();
    const item = await ingestWorkItem(await seededFreshdeskConnId(), rawItem());
    const res = await call(`/${flow.id}/run`, admin, "POST", {
      work_item_id: item.id,
    });
    expect(res.status).toBe(202);
    const [run] =
      await sql`select params, trigger from job_runs where kind = 'flow.run'`;
    expect(run).toMatchObject({
      trigger: "manual",
      params: { flow_id: flow.id, work_item_id: item.id, dry_run: true },
    });
  });
});

describe("Freshdesk option lists", () => {
  it("reads each shape Freshdesk gives a field's choices in", async () => {
    const { fieldChoices, ticketFieldPath } =
      await import("@tachy/source-freshdesk");
    expect(fieldChoices(["Question", "Incident"])).toEqual([
      { value: "Question", label: "Question" },
      { value: "Incident", label: "Incident" },
    ]);
    expect(fieldChoices({ Low: 1, Urgent: 4 })).toEqual([
      { value: "1", label: "Low" },
      { value: "4", label: "Urgent" },
    ]);
    expect(fieldChoices({ "2": ["Open", "Being processed"] })).toEqual([
      { value: "2", label: "Open" },
    ]);
    expect(fieldChoices({ Plant: { "Line 1": [] } })).toEqual([
      { value: "Plant", label: "Plant" },
    ]);
    expect(ticketFieldPath({ name: "ticket_type", default: true })).toBe(
      "type",
    );
    expect(ticketFieldPath({ name: "cf_line", default: false })).toBe(
      "custom_fields.cf_line",
    );
  });
});

describe("the flow.run job", () => {
  beforeEach(async () => {
    await resetData();
    await resetJobs();
    written.length = 0;
  });

  const job = () => {
    registerCoreJobs();
    return getJobKind("flow.run");
  };
  /* A run's trace points at its job run, so the context carries a real one. */
  const ctx = async (queued: unknown[], flowId: string) => ({
    runId: (await enqueueRun({
      kind: "flow.run",
      params: { flow_id: flowId, trigger_id: "ctx" },
      trigger: "manual",
    }))!,
    requestedBy: null,
    signal: new AbortController().signal,
    progress: async () => {},
    log: () => {},
    credential: async () => undefined,
    enqueue: async (_kind: string, params: unknown) => {
      queued.push(params);
      return "child";
    },
  });

  it("leaves a paused flow alone unless someone runs it by hand", async () => {
    const flow = await createFlow(
      {
        name: "paused",
        team_id: null,
        enabled: false,
        graph: {
          triggers: [
            {
              id: "s",
              kind: "item.synced",
              params: { connection: "test-freshdesk" },
            },
            { id: "m", kind: "manual" },
          ],
          steps: [
            {
              id: "w",
              kind: "action",
              action: "test.write",
              params: { body: "hi" },
            },
          ],
        },
      },
      null,
    );
    expect(
      await job().run(await ctx([], flow.id), {
        flow_id: flow.id,
        trigger_id: "s",
        dry_run: false,
      }),
    ).toEqual({ skipped: "the flow is paused" });
    const out = await job().run(await ctx([], flow.id), {
      flow_id: flow.id,
      trigger_id: "m",
      dry_run: false,
    });
    expect(out).toMatchObject({ status: "succeeded" });
    expect(written).toEqual(["hi"]);
  });

  it("fans a schedule out to one run per recent item that matches", async () => {
    const connId = await seededFreshdeskConnId();
    const hit = await ingestWorkItem(
      connId,
      rawItem({ sourceUpdatedAt: new Date().toISOString() }),
    );
    await ingestWorkItem(
      connId,
      rawItem({
        externalId: "7002",
        status: "5",
        sourceUpdatedAt: new Date().toISOString(),
      }),
    );
    const flow = await createFlow(
      {
        name: "sweep",
        team_id: null,
        enabled: true,
        graph: {
          triggers: [
            {
              id: "nightly",
              kind: "schedule",
              params: { cron: "0 2 * * *", connection: "test-freshdesk" },
              where: { field: "item.status", op: "eq", value: "2" },
            },
          ],
          steps: [],
        },
      },
      null,
    );
    const queued: unknown[] = [];
    const out = await job().run(await ctx(queued, flow.id), {
      flow_id: flow.id,
      trigger_id: "nightly",
      dry_run: false,
    });
    expect(out).toEqual({ matched: 1, queued: 1 });
    expect(queued).toEqual([
      {
        flow_id: flow.id,
        trigger_id: "nightly",
        work_item_id: hit.id,
        dry_run: false,
      },
    ]);
  });
});
