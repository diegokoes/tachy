import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addCustomer,
  changeTagList,
  createFlow,
  getCustomerIdBySlug,
  ingestWorkItem,
  listFlowRuns,
  listOptions,
  loadSubject,
  registerSource,
  runFlow,
  setCustomerFact,
  setWorkItemCustomer,
  type RawWorkItem,
  type SourceFactory,
} from "@tachy/core";
import { resetData, sql } from "../helpers";

afterAll(async () => {
  await sql`delete from source_connections where slug = 'fake-flow-conn'`;
  await sql.end();
});

let tags: string[] = [];
const factory: SourceFactory = () => ({
  type: "fake-flow",
  capabilities: { postNote: false, incrementalSync: false },
  async fetchItem() {
    throw new Error("not used");
  },
  async listItems() {
    return { items: [] };
  },
  async options(name) {
    return name === "company_fields"
      ? [
          { value: "name", label: "Company name" },
          { value: "prod_tenant", label: "Prod tenant" },
          { value: "contact", label: "Contact" },
        ]
      : [];
  },
  async customerRecord(raw) {
    return (raw as { company_id?: number }).company_id === 42
      ? {
          id: 42,
          name: "Acme Bottling GmbH",
          prod_tenant: "acme-prod-eu",
          contact: "ops lead jane.doe@acme.example",
        }
      : null;
  },
  async setTags(_id, change) {
    tags = changeTagList(tags, change);
    return tags;
  },
});
registerSource("fake-flow", factory);

const rawItem = (over: Partial<RawWorkItem> = {}): RawWorkItem => ({
  externalId: "9001",
  kind: "ticket",
  title: "Line 3 stopped",
  raw: { id: 9001, tags: ["bug"], company_id: 42 },
  messages: [],
  ...over,
});

const noop = {
  signal: new AbortController().signal,
  log: () => {},
  enqueue: async () => null,
};

async function connId(): Promise<string> {
  const [row] =
    await sql`select id from source_connections where slug = 'fake-flow-conn'`;
  return row.id as string;
}

async function run(steps: unknown[], workItemId: string, dryRun = false) {
  const flow = await createFlow(
    {
      name: `f${Math.random()}`,
      team_id: null,
      enabled: true,
      graph: { triggers: [{ id: "m", kind: "manual", params: {} }], steps },
    } as never,
    null,
  );
  const res = await runFlow({
    ...noop,
    flow,
    triggerId: "m",
    workItemId,
    dryRun,
    jobRunId: null,
  });
  const [r] = await listFlowRuns(flow.id);
  return { res, steps: r.steps };
}

async function acmeItem() {
  await addCustomer({ name: "Acme Bottling", slug: "acme" });
  await setCustomerFact({
    customerSlug: "acme",
    kind: "tenant",
    label: "prod",
    value: "acme-prod.example.com",
  });
  await setCustomerFact({ customerSlug: "acme", kind: "region", value: "eu" });
  const item = await ingestWorkItem(await connId(), rawItem());
  await setWorkItemCustomer(item.id, await getCustomerIdBySlug("acme"));
  return item;
}

beforeEach(async () => {
  await resetData();
  tags = ["bug"];
  await sql`delete from source_connections where slug = 'fake-flow-conn'`;
  await sql`
    insert into source_connections (source_type, slug, base_url)
    values ('fake-flow', 'fake-flow-conn', 'https://example.invalid')
  `;
});

describe("customer.properties", () => {
  it("returns only the picked facts and company fields", async () => {
    const item = await acmeItem();
    const { res, steps } = await run(
      [
        {
          id: "props",
          kind: "action",
          action: "customer.properties",
          params: {
            keys: ["tenant-prod", "company-prod_tenant", "company-missing"],
          },
        },
        {
          id: "gate",
          kind: "filter",
          when: {
            field: "steps.props.values.company-prod_tenant",
            op: "eq",
            value: "acme-prod-eu",
          },
        },
      ],
      item.id,
    );
    expect(res.status).toBe("succeeded");
    expect(steps[0].output).toEqual({
      found: true,
      customer: "acme",
      values: {
        "tenant-prod": "acme-prod.example.com",
        "company-prod_tenant": "acme-prod-eu",
        "company-missing": null,
      },
      text: "tenant-prod: acme-prod.example.com\ncompany-prod_tenant: acme-prod-eu\ncompany-missing: (none)",
    });
    expect(steps[1].held).toBe(true);
  });

  it("redacts the values when the connection asks for it", async () => {
    await sql`update source_connections set config = ${sql.json({ redaction: { enabled: true } })} where slug = 'fake-flow-conn'`;
    const item = await acmeItem();
    const { steps } = await run(
      [
        {
          id: "props",
          kind: "action",
          action: "customer.properties",
          params: {
            keys: ["company-name", "company-contact", "company-prod_tenant"],
          },
        },
      ],
      item.id,
    );
    const values = (steps[0].output as { values: Record<string, string> })
      .values;
    expect(values["company-name"]).toBe("acme");
    expect(values["company-contact"]).not.toContain("jane.doe@acme.example");
    expect(values["company-contact"]).toContain("[EMAIL_");
    expect(values["company-prod_tenant"]).toBe("acme-prod-eu");
  });

  it("finds nothing for an item without a customer", async () => {
    const item = await ingestWorkItem(
      await connId(),
      rawItem({ raw: { id: 9001 } }),
    );
    const { steps } = await run(
      [
        {
          id: "props",
          kind: "action",
          action: "customer.properties",
          params: { keys: ["region"] },
        },
      ],
      item.id,
    );
    expect(steps[0].output).toMatchObject({
      found: false,
      values: { region: null },
    });
  });

  it("lists facts in use and the source's company fields as keys", async () => {
    await acmeItem();
    const scope = {};
    const own = await listOptions("customer.properties", {
      scope,
      params: {},
    });
    expect(own.map((o) => o.value)).toEqual(["region", "tenant-prod"]);
    const all = await listOptions("customer.properties", {
      scope,
      params: { connection: "fake-flow-conn" },
    });
    expect(all.map((o) => o.value)).toEqual([
      "region",
      "tenant-prod",
      "company-name",
      "company-prod_tenant",
      "company-contact",
    ]);
  });
});

describe("tag steps", () => {
  it("adds and removes tags, and later conditions see the result", async () => {
    const item = await ingestWorkItem(await connId(), rawItem());
    const { res, steps } = await run(
      [
        {
          id: "add",
          kind: "action",
          action: "item.add_tags",
          params: { tags: ["Escalated", "BUG"] },
        },
        {
          id: "remove",
          kind: "action",
          action: "item.remove_tags",
          params: { tags: ["bug"] },
        },
        {
          id: "gate",
          kind: "filter",
          when: { field: "item.tags", op: "contains", value: "escalated" },
        },
      ],
      item.id,
    );
    expect(res.status).toBe("succeeded");
    expect(tags).toEqual(["Escalated"]);
    expect(steps.map((s) => s.output)).toEqual([
      { tags: ["bug", "Escalated"] },
      { tags: ["Escalated"] },
      undefined,
    ]);
    expect(steps[2].held).toBe(true);
  });

  it("only says what it would do in a dry run", async () => {
    const item = await ingestWorkItem(await connId(), rawItem());
    const { steps } = await run(
      [
        {
          id: "add",
          kind: "action",
          action: "item.add_tags",
          params: { tags: ["x"] },
        },
      ],
      item.id,
      true,
    );
    expect(steps[0]).toMatchObject({
      status: "dry",
      output: { would: { tags: ["x"] } },
    });
    expect(tags).toEqual(["bug"]);
  });

  it("fails on a source that cannot take tags", async () => {
    registerSource("fake-flow-plain", ((cfg) => ({
      ...factory(cfg),
      setTags: undefined,
    })) as SourceFactory);
    await sql`
      insert into source_connections (source_type, slug, base_url)
      values ('fake-flow-plain', 'fake-flow-plain', 'https://example.invalid')
      on conflict (slug) do nothing
    `;
    const [conn] =
      await sql`select id from source_connections where slug = 'fake-flow-plain'`;
    const item = await ingestWorkItem(conn.id as string, rawItem());
    await expect(
      run(
        [
          {
            id: "add",
            kind: "action",
            action: "item.add_tags",
            params: { tags: ["x"] },
          },
        ],
        item.id,
      ),
    ).rejects.toThrow("fake-flow-plain items cannot take tags");
    await sql`delete from source_connections where slug = 'fake-flow-plain'`;
  });

  it("offers the tags the connection's items carry", async () => {
    await ingestWorkItem(await connId(), rawItem());
    const opts = await listOptions("item.tags", {
      scope: {},
      params: { connection: "fake-flow-conn" },
    });
    expect(opts.map((o) => o.value)).toEqual(["bug"]);
  });
});

describe("tags on ADO items", () => {
  it("reads them from System.Tags", async () => {
    const item = await ingestWorkItem(
      await connId(),
      rawItem({ raw: { fields: { "System.Tags": "Plant-3; urgent ;" } } }),
    );
    expect((await loadSubject(item.id)).tags).toEqual(["Plant-3", "urgent"]);
  });
});

describe("changeTagList", () => {
  it("keeps tags it already has in their own case", () => {
    expect(
      changeTagList(["Bug", "plant-3"], { add: ["bug", " new "], remove: [] }),
    ).toEqual(["Bug", "plant-3", "new"]);
    expect(
      changeTagList(["Bug", "plant-3"], { add: [], remove: ["BUG", "gone"] }),
    ).toEqual(["plant-3"]);
  });
});
