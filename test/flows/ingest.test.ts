/**
 * Ingest rules: which messages, fields and guidance a model is given of an
 * item, and how the config is read back when part of it no longer parses.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { IngestConfig } from "@tachy/contract";
import {
  applyIngest,
  flowAction,
  getIngestConfig,
  ingestConfig,
  setIngestConfig,
  type FlowSubject,
} from "@tachy/core/flows";
import {
  addSourceConnection,
  registerSource,
  type RawWorkItem,
} from "@tachy/core/sources";
import { SUMMARY_MARKER } from "@tachy/core/work-items";
import { resetData, sql } from "../database";

afterAll(() => sql.end());

const ANALYSIS = "AI analysis: the customer may be experiencing an issue.";

function ticket(extra: Partial<RawWorkItem> = {}): RawWorkItem {
  return {
    externalId: "77",
    kind: "ticket",
    title: "Labels print blank",
    groupKey: "12",
    raw: {
      subject: "Labels print blank",
      description_text: "Labels print blank since the update.",
      custom_fields: { cf_area: "printing", cf_effort: 2 },
      tags: ["printing"],
    },
    messages: [
      {
        externalId: "desc-77",
        direction: "incoming",
        visibility: "public",
        bodyText: "Labels print blank since the update.",
      },
      {
        externalId: "1",
        author: "900",
        authorLabel: "A. Manager",
        direction: "outgoing",
        visibility: "private",
        bodyText: ANALYSIS,
      },
      {
        externalId: "2",
        author: "901",
        direction: "outgoing",
        visibility: "public",
        bodyText: "Could you send the printer log?",
      },
    ],
    ...extra,
  };
}

const byAuthor: IngestConfig = {
  skip: [
    {
      id: "manager",
      label: "Manager analysis",
      enabled: true,
      where: { field: "message.author", op: "eq", value: "900" },
    },
  ],
};

const bodies = (item: RawWorkItem) => item.messages.map((m) => m.bodyText);

describe("skip rules", () => {
  it("leaves out the messages a rule matches and names the rule", () => {
    const outcome = applyIngest(ticket(), byAuthor);
    expect(bodies(outcome.item)).not.toContain(ANALYSIS);
    expect(bodies(outcome.kept)).not.toContain(ANALYSIS);
    expect(outcome.item.messages).toHaveLength(2);
    expect(outcome.skipped).toEqual([{ key: "1", rule: "manager" }]);
  });

  it("matches on visibility and text together", () => {
    const outcome = applyIngest(ticket(), {
      skip: [
        {
          id: "ai-notes",
          label: "AI notes",
          enabled: true,
          where: {
            all: [
              { field: "message.visibility", op: "eq", value: "private" },
              { field: "message.body", op: "matches", value: "^ai analysis" },
            ],
          },
        },
      ],
    });
    expect(outcome.skipped.map((s) => s.key)).toEqual(["1"]);
  });

  it("ignores a disabled rule", () => {
    const outcome = applyIngest(ticket(), {
      skip: [{ ...byAuthor.skip![0], enabled: false }],
    });
    expect(outcome.item.messages).toHaveLength(3);
    expect(outcome.skipped).toEqual([]);
  });

  it("narrows a rule to some groups through the item", () => {
    const inGroup = (group: string): IngestConfig => ({
      skip: [
        {
          ...byAuthor.skip![0],
          where: {
            all: [
              byAuthor.skip![0].where,
              { field: "item.group", op: "in", value: [group] },
            ],
          },
        },
      ],
    });
    expect(applyIngest(ticket(), inGroup("12")).skipped).toHaveLength(1);
    expect(applyIngest(ticket(), inGroup("13")).skipped).toHaveLength(0);
  });

  it("never leaves out a note tachy wrote, which a later run replaces", () => {
    const item = ticket();
    item.messages[1].bodyText = `Summary\n${SUMMARY_MARKER}`;
    const outcome = applyIngest(item, byAuthor);
    expect(outcome.item.messages).toHaveLength(3);
  });
});

describe("payload fields", () => {
  it("sends only the listed paths, nested ones included", () => {
    const { item, kept } = applyIngest(ticket(), {
      fields: { mode: "only", paths: ["subject", "custom_fields.cf_area"] },
    });
    expect(item.raw).toEqual({
      subject: "Labels print blank",
      custom_fields: { cf_area: "printing" },
    });
    expect((kept.raw as Record<string, unknown>).tags).toEqual(["printing"]);
  });

  it("sends everything but the listed paths, and never the omitted ones", () => {
    const { item } = applyIngest(
      ticket(),
      { fields: { mode: "except", paths: ["custom_fields.cf_effort"] } },
      ["description_text"],
    );
    expect(item.raw).toEqual({
      subject: "Labels print blank",
      custom_fields: { cf_area: "printing" },
      tags: ["printing"],
    });
  });

  it("drops the omitted paths with no field selection, leaving the input whole", () => {
    const original = ticket();
    const { item } = applyIngest(original, {}, ["description_text"]);
    expect(item.raw).not.toHaveProperty("description_text");
    expect(original.raw).toHaveProperty("description_text");
  });

  it("keeps an omitted path out of an allowlist that names it", () => {
    const { item } = applyIngest(
      ticket(),
      { fields: { mode: "only", paths: ["subject", "description_text"] } },
      ["description_text"],
    );
    expect(item.raw).toEqual({ subject: "Labels print blank" });
  });
});

describe("guidance", () => {
  it("is the item's group's text, trimmed", () => {
    const config = { guidance: { "12": "  Check the label template first. " } };
    expect(applyIngest(ticket(), config).guidance).toBe(
      "Check the label template first.",
    );
    expect(
      applyIngest(ticket({ groupKey: "13" }), config).guidance,
    ).toBeUndefined();
  });
});

describe("the saved config", () => {
  beforeEach(resetData);

  it("drops a rule that no longer parses and keeps the rest", () => {
    const config = ingestConfig({
      ingest: {
        skip: [byAuthor.skip![0], { id: "bad id!", where: {} }],
        guidance: { "12": "text" },
        unknown: true,
      },
    });
    expect(config.skip?.map((r) => r.id)).toEqual(["manager"]);
    expect(config.guidance).toEqual({ "12": "text" });
  });

  it("is empty when a connection has none", () => {
    expect(ingestConfig({})).toEqual({});
    expect(ingestConfig(null)).toEqual({});
  });

  it("is saved beside the connection's other settings", async () => {
    await addSourceConnection({
      sourceType: "freshdesk",
      slug: "fd-ingest",
      baseUrl: "https://example.invalid",
      config: { redaction: { enabled: true } },
    });
    await setIngestConfig("fd-ingest", byAuthor);
    expect(await getIngestConfig("fd-ingest")).toEqual(byAuthor);
    const [row] = await sql`
      select config from source_connections where slug = 'fd-ingest'
    `;
    expect(row.config.redaction).toEqual({ enabled: true });
  });

  it("refuses a connection that does not exist", async () => {
    await expect(setIngestConfig("nope", {})).rejects.toThrow(/not found/);
    await expect(getIngestConfig("nope")).rejects.toThrow(/not found/);
  });
});

registerSource("fake-ingest-step", () => ({
  type: "fake-ingest-step",
  capabilities: { postNote: false, incrementalSync: false },
  async fetchItem() {
    return ticket();
  },
  async listItems() {
    return { items: [] };
  },
}));

describe("the Read ticket step", () => {
  beforeEach(resetData);

  it("hands on the messages a model may read and the group's guidance", async () => {
    await addSourceConnection({
      sourceType: "fake-ingest-step",
      slug: "fd-step",
      baseUrl: "https://example.invalid",
      config: {
        ingest: { ...byAuthor, guidance: { "12": "Ask for the log." } },
      },
    });
    const step = flowAction("item.fetch");
    const result = (await step.run(
      {
        flowId: "f",
        flowRunId: "r",
        stepId: "s",
        scope: {},
        userId: null,
        item: {
          external_id: "77",
          connection: "fd-step",
          source_type: "fake-ingest-step",
        } as FlowSubject,
        signal: new AbortController().signal,
        log: () => {},
        enqueue: async () => null,
      },
      step.params.parse({}),
    )) as { messages: unknown[]; text: string; guidance: string | null };
    expect(result.messages).toHaveLength(2);
    expect(result.text).not.toContain(ANALYSIS);
    expect(result.guidance).toBe("Ask for the log.");
  });
});
