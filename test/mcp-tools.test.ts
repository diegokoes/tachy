import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  addSourceConnection,
  addResolutionPattern,
  registerSource,
  type RawWorkItem,
  type SourceFactory,
} from "@tachy/core";
import { server } from "../packages/mcp/src/index";
import { resetData, sql, tpdProductId } from "./helpers";

afterAll(() => sql.end());

/**
 * The tools themselves, over a real MCP client. Everything below the tool layer
 * has its own suite; what this covers is the layer that only exists here — the
 * zod schemas, the result envelope, and the `note:` / `next:` guidance the
 * agent actually reads. Those travel with the tool by design (see CLAUDE.md),
 * so they need a test that goes through the tool rather than around it.
 */
let client: Client;

/** Every tool answers with content[0].text; parse it back where it is JSON. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  const text = res.content[0]?.text ?? "";
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { isError: res.isError === true, text, json: json as never };
}

const fakeItem: RawWorkItem = {
  externalId: "ctx-1",
  kind: "ticket",
  title: "printer stops mid-batch on line 3",
  status: "open",
  requester: "ops@acme-not-a-customer.invalid",
  messages: [
    {
      externalId: "1",
      direction: "incoming",
      visibility: "public",
      bodyText: "The printer stops mid-batch and the queue never drains.",
      author: "ops@acme-not-a-customer.invalid",
    },
  ],
  raw: {},
};

const fakeFactory: SourceFactory = () => ({
  type: "fake-mcp",
  capabilities: { postNote: false, incrementalSync: false },
  async fetchItem() {
    return fakeItem;
  },
  async listItems() {
    return { items: [] };
  },
  async verify() {
    return { identity: "svc@example.invalid", groups: [] };
  },
});
registerSource("fake-mcp", fakeFactory);

beforeAll(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(b), client.connect(a)]);
});

afterAll(() => client.close());

beforeEach(resetData);

describe("tool registration", () => {
  /**
   * Every word of a tool's description is paid for on every agent turn that
   * lists it, so an undescribed tool is a bug in both directions: the model
   * cannot tell when to call it, and nothing else says so.
   */
  it("gives every tool a description and an input schema", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(50);
    const bad = tools.filter(
      (t) => !t.description || t.description.length < 20 || !t.inputSchema,
    );
    expect(bad.map((t) => t.name)).toEqual([]);
  });

  it("names its tools in snake_case, the way the prompt refers to them", async () => {
    const { tools } = await client.listTools();
    expect(tools.filter((t) => !/^[a-z][a-z0-9_]*$/.test(t.name))).toEqual([]);
  });
});

describe("knowledge round trip", () => {
  it("saves an entry, reads it back, and finds it by search", async () => {
    const saved = await call("save_knowledge_entry", {
      product_slug: "tpd",
      status: "approved",
      issue_summary: "Label renderer drops the last row on long batches",
      symptoms: ["last row missing"],
      root_cause: "the renderer paginates before the final flush",
      resolution: "flush before paginating",
      cloud: "prod",
      resolution_clarity: "clear",
    });
    expect(saved.isError).toBe(false);
    const id = (saved.json as { id: string }).id;
    expect(id).toBeTruthy();

    const got = await call("get_knowledge_entry", { id });
    expect(got.isError).toBe(false);
    expect(got.text).toMatch(/Label renderer drops the last row/);

    const found = await call("search_knowledge", {
      query: "label renderer drops the last row on long batches",
    });
    expect(found.isError).toBe(false);
    expect(found.text).toMatch(/Label renderer/);
  });

  it("lists entries and accepts feedback on one", async () => {
    const saved = await call("save_knowledge_entry", {
      product_slug: "tpd",
      issue_summary: "Scanner bridge refuses TLS 1.3",
    });
    const id = (saved.json as { id: string }).id;

    const listed = await call("list_knowledge_entries", {
      product_slug: "tpd",
    });
    expect(listed.text).toMatch(/Scanner bridge/);

    const fb = await call("add_knowledge_feedback", {
      knowledge_entry_id: id,
      kind: "rating",
      rating: 5,
    });
    expect(fb.isError).toBe(false);
  });

  it("updates an entry through its own tool", async () => {
    const saved = await call("save_knowledge_entry", {
      product_slug: "tpd",
      issue_summary: "Queue dispatcher retries without backoff",
      status: "draft",
    });
    const id = (saved.json as { id: string }).id;
    const updated = await call("update_knowledge_entry", {
      id,
      status: "approved",
      resolution: "enable exponential backoff",
    });
    expect(updated.isError).toBe(false);
    const got = await call("get_knowledge_entry", { id });
    expect(got.text).toMatch(/approved/);
    expect(got.text).toMatch(/exponential backoff/);
  });
});

describe("customer round trip", () => {
  it("adds a customer, records a fact, and reads the profile back", async () => {
    const added = await call("add_customer", {
      name: "Northwind Packaging",
      slug: "northwind",
      email_domains: ["northwind.invalid"],
    });
    expect(added.isError).toBe(false);

    const fact = await call("set_customer_fact", {
      customer: "northwind",
      kind: "version",
      label: "tpd",
      value: "9.2",
    });
    expect(fact.isError).toBe(false);

    const profile = await call("get_customer_profile", {
      customer: "northwind",
    });
    expect(profile.isError).toBe(false);
    expect(profile.text).toMatch(/9\.2/);

    const listed = await call("list_customers");
    expect(listed.text).toMatch(/northwind/);
  });

  it("refuses a fact for a customer that does not exist", async () => {
    const res = await call("set_customer_fact", {
      customer: "no-such-customer",
      kind: "version",
      value: "1.0",
    });
    expect(res.isError).toBe(true);
  });
});

describe("reference and wiki round trips", () => {
  it("saves a reference doc and finds it by search", async () => {
    const saved = await call("save_reference_doc", {
      title: "Firmware rollout procedure",
      body: "Stage the image on the CDN, then roll the fleet one lane at a time.",
      product_slug: "tpd",
    });
    expect(saved.isError).toBe(false);

    const found = await call("search_reference", {
      query: "stage the firmware image on the CDN",
    });
    expect(found.text).toMatch(/Firmware rollout/);
  });

  it("saves a wiki article and lists it", async () => {
    const saved = await call("save_wiki_article", {
      slug: "spooler-stalls",
      title: "Spooler stalls",
      body: "## Overview\n\nWhat to do when the spooler stalls.",
      product_slug: "tpd",
    });
    expect(saved.isError).toBe(false);

    const listed = await call("list_wiki_articles", { product_slug: "tpd" });
    expect(listed.text).toMatch(/spooler-stalls/);
  });

  /** 'toc' and 'c' are the wiki's own routes; an article there is unreachable. */
  it("refuses a wiki article at a reserved slug", async () => {
    const res = await call("save_wiki_article", {
      slug: "toc",
      title: "Contents",
      body: "no",
      product_slug: "tpd",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/reserved/i);
  });
});

describe("taxonomy tools", () => {
  it("adds a component and lists it under its product", async () => {
    const added = await call("add_component", {
      product_slug: "tpd",
      slug: "label-renderer",
      name: "Label renderer",
    });
    expect(added.isError).toBe(false);

    const listed = await call("list_components", { product_slug: "tpd" });
    expect(listed.text).toMatch(/label-renderer/);
  });

  /** Adding an existing slug rewrites its description rather than failing. */
  it("upserts a resolution pattern on a repeated slug", async () => {
    await addResolutionPattern("clock-skew", "The clock is wrong.");
    const again = await call("add_resolution_pattern", {
      slug: "clock-skew",
      description: "The scheduler stores local time rather than UTC.",
    });
    expect(again.isError).toBe(false);
    const listed = await call("list_resolution_patterns");
    expect(listed.text).toMatch(/stores local time/);
    expect(listed.text).not.toMatch(/The clock is wrong/);
  });

  it("adds a resolution pattern and lists it", async () => {
    const added = await call("add_resolution_pattern", {
      slug: "retry-storm",
      description: "A retry without backoff saturates the pool.",
    });
    expect(added.isError).toBe(false);
    const listed = await call("list_resolution_patterns");
    expect(listed.text).toMatch(/retry-storm/);
  });

  it("lists the teams and products the fixtures set up", async () => {
    expect((await call("list_teams")).text).toMatch(/test-team/);
    expect((await call("list_products")).text).toMatch(/tpd/);
  });
});

/**
 * The part that only exists at this layer. Each of these strings is what the
 * model reads instead of a bare empty array or a null column, and each was
 * added because its absence produced a specific wrong answer.
 */
describe("result guidance", () => {
  it("says the archive is empty rather than returning a bare []", async () => {
    const res = await call("search_knowledge", {
      query: "a query about something nobody has ever written down",
    });
    expect(res.isError).toBe(false);
    const body = res.json as { results: unknown[]; note: string };
    expect(body.results).toEqual([]);
    expect(body.note).toMatch(/nothing on this/i);
  });

  it("carries the grade calibration on a search that did hit", async () => {
    await call("save_knowledge_entry", {
      product_slug: "tpd",
      status: "approved",
      issue_summary: "Ink telemetry reads negative after a counter wrap",
      root_cause: "the counter is unsigned and wraps at zero",
      resolution: "clamp at zero and reset the baseline",
    });
    const res = await call("search_knowledge", {
      query: "ink telemetry reads negative",
    });
    expect(res.text).toMatch(/relevance/);
  });

  it("surfaces an unmatched customer on a fetched work item", async () => {
    await addSourceConnection({
      sourceType: "fake-mcp",
      slug: "fake-mcp-conn",
      baseUrl: "https://example.invalid",
    });
    const res = await call("get_context", {
      source: "fake-mcp-conn",
      external_id: "ctx-1",
    });
    expect(res.isError).toBe(false);
    const body = res.json as {
      customer_id: string | null;
      customer_note: string;
      retrieval_note?: string;
    };
    expect(body.customer_id).toBeNull();
    // The requester's own domain is exactly the wrong thing to infer from.
    expect(body.customer_note).toMatch(/partners and distributors/i);
    expect(body.retrieval_note).toMatch(/nothing on this/i);
  });
});

describe("failures come back as tool errors", () => {
  it("reports an unknown resolution_pattern readably", async () => {
    const res = await call("save_knowledge_entry", {
      product_slug: "tpd",
      issue_summary: "x",
      resolution_pattern: "does-not-exist",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/resolution_pattern/i);
  });

  it("rejects a call that omits a required field", async () => {
    const res = await call("get_knowledge_entry", {});
    expect(res.isError).toBe(true);
  });

  it("reports an unknown source connection rather than throwing", async () => {
    const res = await call("get_context", {
      source: "no-such-connection",
      external_id: "1",
    });
    expect(res.isError).toBe(true);
  });

  it("refuses a component under a product that does not exist", async () => {
    const res = await call("add_component", {
      product_slug: "no-such-product",
      slug: "x",
      name: "X",
    });
    expect(res.isError).toBe(true);
  });
});

describe("search scoping", () => {
  it("keeps another product's entries out of a scoped search", async () => {
    await call("save_knowledge_entry", {
      product_slug: "tpd",
      status: "approved",
      issue_summary: "Dryline overshoots its setpoint by twenty degrees",
    });
    const scoped = await call("search_knowledge", {
      query: "dryline overshoots its setpoint",
      product_slug: "ftrace",
    });
    expect(scoped.text).not.toMatch(/Dryline overshoots/);
    expect(await tpdProductId()).toBeTruthy();
  });
});
