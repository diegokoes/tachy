/**
 * A connection's ingest rules on the tools that read a ticket: the model's
 * copy leaves out what they skip, the stored copy keeps every message.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { IngestConfig } from "@tachy/contract";
import {
  addSourceConnection,
  registerSource,
  type RawWorkItem,
} from "@tachy/core/sources";
import { server } from "../../packages/mcp/src/index";
import { resetData, sql } from "../database";

afterAll(() => sql.end());

const ANALYSIS = "AI analysis: nothing of substance, at great length.";

const ticket: RawWorkItem = {
  externalId: "fd-9",
  kind: "ticket",
  title: "Export to the carrier fails",
  groupKey: "12",
  raw: {
    subject: "Export to the carrier fails",
    description_text: "The carrier export fails with a timeout.",
    custom_fields: { cf_area: "export", cf_internal_score: 7 },
  },
  messages: [
    {
      externalId: "desc-fd-9",
      direction: "incoming",
      visibility: "public",
      bodyText: "The carrier export fails with a timeout.",
    },
    {
      externalId: "31",
      author: "900",
      direction: "outgoing",
      visibility: "private",
      bodyText: ANALYSIS,
    },
    {
      externalId: "32",
      author: "901",
      direction: "outgoing",
      visibility: "public",
      bodyText: "Which carrier, and since when? Mail me at ana@example.com.",
    },
  ],
};

registerSource("fake-ingest", () => ({
  type: "fake-ingest",
  capabilities: { postNote: false, incrementalSync: false },
  modelOmits: ["description_text"],
  async fetchItem() {
    return structuredClone(ticket);
  },
  async listItems() {
    return { items: [] };
  },
}));

const ingest: IngestConfig = {
  skip: [
    {
      id: "manager",
      label: "Manager analysis",
      enabled: true,
      where: { field: "message.author", op: "eq", value: "900" },
    },
  ],
  fields: { mode: "except", paths: ["custom_fields.cf_internal_score"] },
  guidance: { "12": "Carrier exports log to the integration console." },
};

let client: Client;

async function call(name: string, args: Record<string, unknown>) {
  const answer = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
  };
  const text = answer.content[0]?.text ?? "";
  return { text, json: JSON.parse(text) };
}

async function connect(config: Record<string, unknown>) {
  await addSourceConnection({
    sourceType: "fake-ingest",
    slug: "fd-rules",
    baseUrl: "https://example.invalid",
    config,
  });
}

beforeAll(async () => {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(() => client.close());

beforeEach(resetData);

describe("fetch_work_item under ingest rules", () => {
  it("leaves the skipped message out of the model's copy and keeps it stored", async () => {
    await connect({ ingest });
    const { text, json } = await call("fetch_work_item", {
      source: "fd-rules",
      external_id: "fd-9",
    });
    expect(text).not.toContain(ANALYSIS);
    expect(json.item.messages).toHaveLength(2);
    expect(json.item.raw).toEqual({
      subject: "Export to the carrier fails",
      custom_fields: { cf_area: "export" },
    });
    expect(json.group_guidance).toBe(
      "Carrier exports log to the integration console.",
    );

    const stored = await sql`
      select m.body_text from work_item_messages m
      join work_items w on w.id = m.work_item_id
      where w.external_id = 'fd-9'
    `;
    expect(stored.map((m) => m.body_text)).toContain(ANALYSIS);
    expect(stored).toHaveLength(3);
  });

  it("redacts what is left after the rules", async () => {
    await connect({ ingest, redaction: { enabled: true } });
    const { text, json } = await call("fetch_work_item", {
      source: "fd-rules",
      external_id: "fd-9",
    });
    expect(text).not.toContain(ANALYSIS);
    expect(text).not.toContain("ana@example.com");
    expect(json.item.messages).toHaveLength(2);
  });

  it("reads the whole ticket when the connection has no rules", async () => {
    await connect({});
    const { text, json } = await call("fetch_work_item", {
      source: "fd-rules",
      external_id: "fd-9",
    });
    expect(text).toContain(ANALYSIS);
    expect(json.group_guidance).toBeUndefined();
    expect(json.item.raw).not.toHaveProperty("description_text");
  });
});

describe("get_context under ingest rules", () => {
  it("leaves the skipped message out and carries the group's guidance", async () => {
    await connect({ ingest });
    const { text, json } = await call("get_context", {
      source: "fd-rules",
      external_id: "fd-9",
    });
    expect(text).not.toContain(ANALYSIS);
    expect(json.work_item.messages).toHaveLength(2);
    expect(json.group_guidance).toMatch(/integration console/);
  });
});

describe("compact_work_item under ingest rules", () => {
  it("compacts only what the model may read", async () => {
    await connect({ ingest });
    const { text } = await call("compact_work_item", {
      source: "fd-rules",
      external_id: "fd-9",
      post_note: false,
      return_turns: true,
    });
    expect(text).not.toContain(ANALYSIS);
    expect(text).toContain("Which carrier");
  });
});
