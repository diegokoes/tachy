/**
 * The steps a helpdesk flow adds: setting a ticket's field and notifying
 * people, and the relative times an SLA watch's condition compares against.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { evaluateCondition } from "@tachy/contract";
import { createUser, setTeamMember } from "@tachy/core/access";
import {
  createFlow,
  flowAction,
  type FlowActionContext,
  type FlowSubject,
} from "@tachy/core/flows";
import { addSourceConnection, registerSource } from "@tachy/core/sources";
import { resetData, sql } from "../database";

afterAll(() => sql.end());

const HOUR_MS = 3_600_000;

describe("relative times in conditions", () => {
  const dueIn = (hours: number) => ({
    item: {
      raw: { fr_due_by: new Date(Date.now() + hours * HOUR_MS).toISOString() },
    },
  });
  const dueSoon = {
    field: "item.raw.fr_due_by",
    op: "lt" as const,
    value: "now+2h",
  };

  it("compares a time with now plus or minus minutes, hours or days", () => {
    expect(evaluateCondition(dueSoon, dueIn(1))).toBe(true);
    expect(evaluateCondition(dueSoon, dueIn(3))).toBe(false);
    expect(
      evaluateCondition(
        { field: "item.raw.fr_due_by", op: "gt", value: "now-1d" },
        dueIn(-2),
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: "item.raw.fr_due_by", op: "lt", value: "now - 30m" },
        dueIn(-1),
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: "item.raw.fr_due_by", op: "lt", value: "NOW" },
        dueIn(-1),
      ),
    ).toBe(true);
  });

  it("does not hold for a field that is not a time", () => {
    expect(
      evaluateCondition(
        { field: "item.raw.fr_due_by", op: "lt", value: "now+2h" },
        { item: { raw: { fr_due_by: "soon" } } },
      ),
    ).toBe(false);
  });
});

const setCalls: { id: string; fields: Record<string, string> }[] = [];

registerSource("fake-fields", () => ({
  type: "fake-fields",
  capabilities: { postNote: false, incrementalSync: false },
  async fetchItem() {
    throw new Error("not used");
  },
  async listItems() {
    return { items: [] };
  },
  async setFields(id: string, fields: Record<string, string>) {
    setCalls.push({ id, fields });
  },
}));

registerSource("fake-no-fields", () => ({
  type: "fake-no-fields",
  capabilities: { postNote: false, incrementalSync: false },
  async fetchItem() {
    throw new Error("not used");
  },
  async listItems() {
    return { items: [] };
  },
}));

let flowCount = 0;

async function context(
  item: Partial<FlowSubject> | null,
  userId: string | null = null,
  stepId = "step-1",
): Promise<FlowActionContext> {
  const flow = await createFlow(
    {
      name: `helpdesk ${flowCount++}`,
      team_id: null,
      enabled: true,
      graph: { triggers: [], steps: [] },
    },
    null,
  );
  return {
    flowId: flow.id,
    flowRunId: flow.id,
    stepId,
    scope: {},
    userId,
    item: item as FlowSubject | null,
    signal: new AbortController().signal,
    log: () => {},
    enqueue: async () => null,
  };
}

beforeEach(async () => {
  await resetData();
  setCalls.length = 0;
  await addSourceConnection({
    sourceType: "fake-fields",
    slug: "fd-fields",
    baseUrl: "https://example.invalid",
  });
  await addSourceConnection({
    sourceType: "fake-no-fields",
    slug: "fd-plain",
    baseUrl: "https://example.invalid",
  });
});

describe("item.set_field", () => {
  it("sets one field on the item through its source", async () => {
    const step = flowAction("item.set_field");
    const result = await step.run(
      await context({
        external_id: "77",
        connection: "fd-fields",
        source_type: "fake-fields",
      }),
      step.params.parse({ field: "status", value: "4" }),
    );
    expect(result).toEqual({ field: "status", value: "4" });
    expect(setCalls).toEqual([{ id: "77", fields: { status: "4" } }]);
  });

  it("refuses a source that cannot set fields, or a run with no item", async () => {
    const step = flowAction("item.set_field");
    const params = step.params.parse({ field: "status", value: "4" });
    await expect(
      step.run(
        await context({
          external_id: "77",
          connection: "fd-plain",
          source_type: "fake-no-fields",
        }),
        params,
      ),
    ).rejects.toThrow(/cannot have fields set/);
    await expect(step.run(await context(null), params)).rejects.toThrow(
      /needs an item/,
    );
  });
});

describe("notify", () => {
  let ownerId: string;
  let memberIds: string[];

  beforeEach(async () => {
    ownerId = (await createUser({ email: "owner@example.com", role: "member" }))
      .id;
    const lead = await createUser({
      email: "lead@example.com",
      role: "member",
    });
    const dev = await createUser({ email: "dev@example.com", role: "member" });
    await setTeamMember("test-team", "lead@example.com", "admin");
    await setTeamMember("test-team", "dev@example.com", "member");
    memberIds = [lead.id, dev.id];
  });

  const ticket = {
    id: "00000000-0000-0000-0000-000000000077",
    external_id: "77",
    connection: "fd-fields",
    url: "https://example.invalid/a/tickets/77",
    team: "test-team",
  };

  const noticesFor = async (userId: string) =>
    sql`select kind, title, body_text, ref from notifications where user_id = ${userId}`;

  it("tells the flow's owner once per item, with a link to it", async () => {
    const step = flowAction("notify");
    const ctx = await context(ticket, ownerId);
    const params = step.params.parse({
      title: "First response due within 2h",
      body: "#77 has no agent reply yet.",
    });
    expect(await step.run(ctx, params)).toEqual({ sent: 1, skipped: 0 });
    expect(await step.run(ctx, params)).toEqual({ sent: 0, skipped: 1 });
    const notices = await noticesFor(ownerId);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      kind: "flow_notice",
      title: "First response due within 2h",
      body_text: "#77 has no agent reply yet.",
      ref: { url: ticket.url, external_id: "77", step_id: "step-1" },
    });
  });

  it("tells again on every run when told to", async () => {
    const step = flowAction("notify");
    const ctx = await context(ticket, ownerId);
    const params = step.params.parse({ title: "t", once_per_item: false });
    await step.run(ctx, params);
    await step.run(ctx, params);
    expect(await noticesFor(ownerId)).toHaveLength(2);
  });

  it("keeps two notify steps of one flow apart", async () => {
    const step = flowAction("notify");
    const first = await context(ticket, ownerId, "warn");
    const params = step.params.parse({ title: "t" });
    await step.run(first, params);
    await step.run({ ...first, stepId: "escalate" }, params);
    expect(await noticesFor(ownerId)).toHaveLength(2);
  });

  it("tells everyone in the item's team", async () => {
    const step = flowAction("notify");
    const result = await step.run(
      await context(ticket, ownerId),
      step.params.parse({ to: "team", title: "t" }),
    );
    expect(result).toEqual({ sent: 2, skipped: 0 });
    for (const id of memberIds) expect(await noticesFor(id)).toHaveLength(1);
    expect(await noticesFor(ownerId)).toHaveLength(0);
  });

  it("tells no one when there is no owner or no team", async () => {
    const step = flowAction("notify");
    expect(
      await step.run(
        await context({ ...ticket, team: null }),
        step.params.parse({ to: "team", title: "t" }),
      ),
    ).toEqual({ sent: 0, skipped: 0 });
    expect(
      await step.run(await context(ticket), step.params.parse({ title: "t" })),
    ).toEqual({ sent: 0, skipped: 0 });
  });
});
