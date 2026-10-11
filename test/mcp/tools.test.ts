/**
 * The tools themselves, over a real MCP client. Everything under the tool layer
 * has its own suite; this covers what exists only here: the zod schemas, the
 * result envelope, and the `note:` / `next:` guidance the agent reads. Those
 * travel with the tool (see CLAUDE.md), so the test goes through the tool.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  addSourceConnection,
  registerSource,
  type RawWorkItem,
  type SourceFactory,
} from "@tachy/core/sources";
import { addResolutionPattern } from "@tachy/core/catalog";
import { sweepWikiGaps } from "@tachy/core/wiki";
import { saveUpload } from "@tachy/core/chat";
import { server } from "../../packages/mcp/src/index";
import { resetData, sql, tpdProductId } from "../database";
import sharp from "sharp";
import { picture, zipOf } from "../fixtures/files";

afterAll(() => sql.end());

let client: Client;

/** Every tool answers with content[0].text; parse it back where it is JSON. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const answer = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  const text = answer.content[0]?.text ?? "";
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { isError: answer.isError === true, text, json: json as never };
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

describe("tool registration", () => {
  // Every word of a tool's description is paid for on every agent turn that
  // lists it, so an undescribed tool is a bug in both directions: the model
  // cannot tell when to call it, and nothing else says so.
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

    const feedback = await call("add_knowledge_feedback", {
      knowledge_entry_id: id,
      kind: "rating",
      rating: 5,
    });
    expect(feedback.isError).toBe(false);
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
    const answer = await call("set_customer_fact", {
      customer: "no-such-customer",
      kind: "version",
      value: "1.0",
    });
    expect(answer.isError).toBe(true);
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

  it("points at the article where it now lives", async () => {
    const saved = await call("save_wiki_article", {
      slug: "label-templates",
      title: "Label templates",
      body: "## Overview\n\nTemplates.",
      product_slug: "tpd",
    });
    expect(saved.text).toContain("/wiki/tpd/label-templates");
    expect(saved.text).not.toContain("/library/wiki");
  });

  it("adds a nested category the article can then be filed under", async () => {
    expect(
      (
        await call("add_wiki_category", {
          product_slug: "tpd",
          slug: "troubleshooting",
          name: "Troubleshooting",
        })
      ).isError,
    ).toBe(false);
    const nested = await call("add_wiki_category", {
      product_slug: "tpd",
      slug: "printing",
      name: "Printing",
      parent: "troubleshooting",
    });
    expect(nested.isError).toBe(false);

    const saved = await call("save_wiki_article", {
      slug: "spooler",
      title: "Spooler",
      body: "b",
      product_slug: "tpd",
      categories: ["printing"],
    });
    expect(saved.isError).toBe(false);
    const listed = (await call("list_wiki_articles", { product_slug: "tpd" }))
      .json as any;
    expect(listed.categories[0].slug).toBe("troubleshooting");
    expect(listed.categories[0].children[0].articles[0].slug).toBe("spooler");
  });

  it("lists a wiki's gaps, and says so when there are none", async () => {
    const empty = (await call("list_wiki_gaps", { product_slug: "tpd" }))
      .json as any;
    expect(empty.gaps).toEqual([]);
    expect(empty.note).toMatch(/Nothing flagged/);

    await call("save_wiki_article", {
      slug: "linker",
      title: "Linker",
      body: "see [[never-written]]",
      product_slug: "tpd",
    });
    await sweepWikiGaps({ productId: await tpdProductId() });
    const found = (await call("list_wiki_gaps", { product_slug: "tpd" }))
      .json as any;
    expect(found.gaps.map((g: any) => [g.kind, g.subject])).toContainEqual([
      "wanted",
      "never-written",
    ]);
    expect(found.note).toBeUndefined();
  });

  // 'toc' and 'c' are the wiki's own routes; an article there is unreachable.
  it("refuses a wiki article at a reserved slug", async () => {
    const answer = await call("save_wiki_article", {
      slug: "toc",
      title: "Contents",
      body: "no",
      product_slug: "tpd",
    });
    expect(answer.isError).toBe(true);
    expect(answer.text).toMatch(/reserved/i);
  });
});

describe("attached files through ingest_context", () => {
  type Sources = {
    sources: {
      source: string;
      chars: number;
      truncated: boolean;
      text: string;
      note?: string;
      matched_lines?: number;
      members?: { name: string; sizeBytes: number }[];
    }[];
  };

  const log = Array.from({ length: 400 }, (_, i) =>
    i === 250 ? "10:02 ERROR timeout on line 3" : `10:0${i % 10} tick ${i}`,
  ).join("\n");

  const uploaded = (filename: string, bytes: Uint8Array) =>
    saveUpload({
      userId: null,
      filename,
      contentType: filename.endsWith(".zip") ? "application/zip" : "text/plain",
      bytes,
    });

  it("says where a truncated read stopped, and reads on from there", async () => {
    const { ref } = await uploaded("app.log", new TextEncoder().encode(log));
    const first = await call("ingest_context", {
      paths: [ref],
      max_chars: 100,
    });
    const [source] = (first.json as Sources).sources;
    expect(source).toMatchObject({ chars: log.length, truncated: true });
    expect(source.note).toMatch(/continue with offset: 100/);

    const next = await call("ingest_context", {
      paths: [ref],
      max_chars: 100,
      offset: 100,
    });
    expect((next.json as Sources).sources[0].text).toBe(log.slice(100, 200));
  });

  it("narrows a log to the lines holding a term", async () => {
    const { ref } = await uploaded("app.log", new TextEncoder().encode(log));
    const found = await call("ingest_context", {
      paths: [ref],
      match: ["error"],
    });
    const [source] = (found.json as Sources).sources;
    expect(source.matched_lines).toBe(1);
    expect(source.truncated).toBe(false);
    expect(source.text).toMatch(/^\[offset \d+\]/);
    expect(source.text.split("\n")).toHaveLength(6);
    expect(source.text).toContain("ERROR timeout on line 3");
  });

  it("lists a zip, then reads the member it is asked for", async () => {
    const { ref } = await uploaded(
      "logs.zip",
      zipOf({ "app.log": log, "notes.md": "# notes" }),
    );
    const listed = await call("ingest_context", { paths: [ref] });
    const [archive] = (listed.json as Sources).sources;
    expect(archive.members?.map((m) => m.name)).toEqual([
      "app.log",
      "notes.md",
    ]);
    expect(archive.note).toMatch(/Read one with member/);

    const member = await call("ingest_context", {
      paths: [ref],
      member: "notes.md",
    });
    expect((member.json as Sources).sources[0]).toMatchObject({
      source: `${ref} > notes.md`,
      text: "# notes",
    });
  });

  it("does not save an archive's file list as a reference doc", async () => {
    const { ref } = await uploaded("logs.zip", zipOf({ "app.log": log }));
    const refused = await call("save_reference_doc", {
      title: "Logs",
      body_path: ref,
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/names an archive/);
  });

  it("refuses member with anything but one path", async () => {
    const refused = await call("ingest_context", {
      text: "pasted",
      member: "notes.md",
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/exactly one path/);
  });
});

describe("reading one attached file", () => {
  type Block = {
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  };

  /** The whole answer: an image arrives as a block of its own, after the text. */
  async function read(name: string, args: Record<string, unknown>) {
    const answer = (await client.callTool({ name, arguments: args })) as {
      content: Block[];
      isError?: boolean;
    };
    return {
      isError: answer.isError === true,
      json: JSON.parse(answer.content[0].text ?? "{}") as Record<string, any>,
      images: answer.content.filter((block) => block.type === "image"),
    };
  }

  const upload = (filename: string, contentType: string, bytes: Uint8Array) =>
    saveUpload({
      userId: null,
      filename,
      contentType: contentType as never,
      bytes,
    });

  it("shows an image as an image, fitted to what a model is given", async () => {
    const { ref } = await upload(
      "screen.png",
      "image/png",
      await picture(3000, 1500),
    );
    const shown = await read("read_file", { path: ref });
    expect(shown.json).toMatchObject({
      file: "screen.png",
      width_px: 2000,
      height_px: 1000,
    });
    expect(shown.images).toHaveLength(1);
    expect(shown.images[0].mimeType).toBe("image/png");
    const sent = await sharp(
      Buffer.from(shown.images[0].data!, "base64"),
    ).metadata();
    expect([sent.width, sent.height]).toEqual([2000, 1000]);
  });

  it("returns a text file as text, and says where to read on", async () => {
    const { ref } = await upload(
      "app.log",
      "text/plain",
      new TextEncoder().encode("0123456789".repeat(30)),
    );
    const shown = await read("read_file", { path: ref, max_chars: 100 });
    expect(shown.images).toHaveLength(0);
    expect(shown.json).toMatchObject({
      file: "app.log",
      chars: 300,
      truncated: true,
      continue_at: 100,
    });
    const rest = await read("read_file", { path: ref, offset: 290 });
    expect(rest.json).toMatchObject({ text: "0123456789", truncated: false });
  });

  it("lists a zip, and shows an image or a text taken out of it", async () => {
    const { ref } = await upload(
      "bundle.zip",
      "application/zip",
      zipOf({ "shot.png": await picture(40, 30), "notes.md": "# notes" }),
    );
    const listed = await read("read_file", { path: ref });
    expect(listed.json.members.map((m: { name: string }) => m.name)).toEqual([
      "shot.png",
      "notes.md",
    ]);
    const image = await read("read_file", { path: ref, member: "shot.png" });
    expect(image.json).toMatchObject({ file: "shot.png", width_px: 40 });
    expect(image.images).toHaveLength(1);
    const text = await read("read_file", { path: ref, member: "notes.md" });
    expect(text.json.text).toBe("# notes");
  });

  it("withholds an image under redaction until the organisation allows it", async () => {
    const { ref } = await upload(
      "screen.png",
      "image/png",
      await picture(40, 30),
    );
    process.env.TACHY_REDACT = "true";
    try {
      const withheld = await read("read_file", { path: ref });
      expect(withheld.isError).toBe(false);
      expect(withheld.images).toHaveLength(0);
      expect(withheld.json.note).toMatch(/withheld: PII redaction is on/);

      const viaIngest = await read("ingest_context", { paths: [ref] });
      expect(viaIngest.images).toHaveLength(0);
      expect(viaIngest.json.sources[0].note).toMatch(/withheld/);

      process.env.TACHY_REDACT_IMAGES = "true";
      expect((await read("read_file", { path: ref })).images).toHaveLength(1);
    } finally {
      delete process.env.TACHY_REDACT;
      delete process.env.TACHY_REDACT_IMAGES;
    }
  });

  it("scrubs a text file under redaction and says placeholders are deliberate", async () => {
    const { ref } = await upload(
      "mail.txt",
      "text/plain",
      new TextEncoder().encode("write to ana.ops@example.com about it"),
    );
    process.env.TACHY_REDACT = "true";
    try {
      const shown = await read("read_file", { path: ref });
      expect(shown.json.text).not.toContain("ana.ops@example.com");
      expect(shown.json.redaction).toMatch(/intentional redactions/);
    } finally {
      delete process.env.TACHY_REDACT;
    }
  });

  it("puts each image of a context dump after the text, numbered", async () => {
    const first = await upload("a.png", "image/png", await picture(40, 30));
    const second = await upload(
      "b.jpg",
      "image/jpeg",
      await picture(60, 20, "jpeg"),
    );
    const notes = await upload(
      "notes.md",
      "text/markdown",
      new TextEncoder().encode("# notes"),
    );
    const loaded = await read("ingest_context", {
      paths: [first.ref, notes.ref, second.ref],
    });
    expect(loaded.images.map((image) => image.mimeType)).toEqual([
      "image/png",
      "image/jpeg",
    ]);
    expect(loaded.json.sources).toMatchObject([
      { source: first.ref, image: 1, width_px: 40 },
      { source: notes.ref, text: "# notes" },
      { source: second.ref, image: 2, width_px: 60 },
    ]);
  });

  it("answers a reference that is not an upload as a tool error", async () => {
    const refused = await call("read_file", { path: "/etc/passwd" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/is not an uploaded file/);
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

  // Adding an existing slug rewrites its description rather than failing.
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

// The part that exists only at this layer: each of these strings is what the
// model reads in place of a bare empty array or a null column.
describe("result guidance", () => {
  it("says the archive is empty rather than returning a bare []", async () => {
    const answer = await call("search_knowledge", {
      query: "a query about something nobody has ever written down",
    });
    expect(answer.isError).toBe(false);
    const body = answer.json as { results: unknown[]; note: string };
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
    const answer = await call("search_knowledge", {
      query: "ink telemetry reads negative",
    });
    expect(answer.text).toMatch(/relevance/);
  });

  it("surfaces an unmatched customer on a fetched work item", async () => {
    await addSourceConnection({
      sourceType: "fake-mcp",
      slug: "fake-mcp-conn",
      baseUrl: "https://example.invalid",
    });
    const answer = await call("get_context", {
      source: "fake-mcp-conn",
      external_id: "ctx-1",
    });
    expect(answer.isError).toBe(false);
    const body = answer.json as {
      customer_id: string | null;
      customer_note: string;
      retrieval_note?: string;
    };
    expect(body.customer_id).toBeNull();
    // The requester's own domain is the wrong thing to infer from.
    expect(body.customer_note).toMatch(/partners and distributors/i);
    expect(body.retrieval_note).toMatch(/nothing on this/i);
  });
});

describe("failures come back as tool errors", () => {
  it("reports an unknown resolution_pattern readably", async () => {
    const answer = await call("save_knowledge_entry", {
      product_slug: "tpd",
      issue_summary: "x",
      resolution_pattern: "does-not-exist",
    });
    expect(answer.isError).toBe(true);
    expect(answer.text).toMatch(/resolution_pattern/i);
  });

  it("rejects a call that omits a required field", async () => {
    const answer = await call("get_knowledge_entry", {});
    expect(answer.isError).toBe(true);
  });

  it("reports an unknown source connection rather than throwing", async () => {
    const answer = await call("get_context", {
      source: "no-such-connection",
      external_id: "1",
    });
    expect(answer.isError).toBe(true);
  });

  it("refuses a component under a product that does not exist", async () => {
    const answer = await call("add_component", {
      product_slug: "no-such-product",
      slug: "x",
      name: "X",
    });
    expect(answer.isError).toBe(true);
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

describe("notes written back to a ticket", () => {
  const posted: string[] = [];
  const deleted: string[] = [];
  let thread: RawWorkItem["messages"] = [];

  registerSource("fake-notes", () => ({
    type: "fake-notes",
    capabilities: { postNote: true, incrementalSync: false },
    async fetchItem() {
      return { ...fakeItem, externalId: "n-1", messages: thread };
    },
    async listItems() {
      return { items: [] };
    },
    async postNote(_id: string, body: string) {
      posted.push(body);
    },
    async deleteNote(id: string) {
      deleted.push(id);
    },
  }));

  const summary = {
    problem: "The printer stops mid-batch on line 3.",
    status: "Waiting on the customer.",
    timeline: [{ date: "2026-06-16", event: "Reported." }],
    tried: [],
  };

  beforeEach(async () => {
    posted.length = 0;
    deleted.length = 0;
    thread = [...fakeItem.messages];
    await addSourceConnection({
      sourceType: "fake-notes",
      slug: "notes-conn",
      baseUrl: "https://example.invalid",
    });
  });

  it("posts the summary as markup it renders itself", async () => {
    const answer = await call("post_work_item_summary", {
      source: "notes-conn",
      external_id: "n-1",
      ...summary,
    });
    expect(answer.isError).toBe(false);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("<strong>Problem</strong>");
    expect(posted[0]).toContain("[tachy:summary]");
    expect(answer.json).toMatchObject({
      posted_private_note: { notes: 1 },
      next: expect.stringContaining("do not restate"),
    });
  });

  it("deletes the summary an earlier call left, and nothing else", async () => {
    thread.push(
      {
        externalId: "old-summary",
        direction: "outgoing",
        visibility: "private",
        bodyText: "Summary ... Generated by tachy [tachy:summary]",
      },
      {
        externalId: "old-transcript",
        direction: "outgoing",
        visibility: "private",
        bodyText: "turns ... [tachy:compacted-transcript]",
      },
    );
    const answer = await call("post_work_item_summary", {
      source: "notes-conn",
      external_id: "n-1",
      ...summary,
    });
    expect(deleted).toEqual(["old-summary"]);
    expect(answer.json).toMatchObject({
      posted_private_note: { notes: 1, replaced_previous: 1 },
    });
  });

  it("refuses a source that takes no notes", async () => {
    await addSourceConnection({
      sourceType: "fake-mcp",
      slug: "fake-mcp-conn",
      baseUrl: "https://example.invalid",
    });
    const answer = await call("post_work_item_summary", {
      source: "fake-mcp-conn",
      external_id: "ctx-1",
      ...summary,
    });
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("does not support notes");
  });

  it("posts the compacted transcript as cards and replaces the previous one", async () => {
    thread.push({
      externalId: "old-transcript",
      direction: "outgoing",
      visibility: "private",
      bodyText: "turns ... [tachy:compacted-transcript]",
    });
    const answer = await call("compact_work_item", {
      source: "notes-conn",
      external_id: "n-1",
    });
    expect(answer.isError).toBe(false);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("<strong>Compacted transcript</strong>");
    expect(posted[0]).toContain("border-left:3px solid");
    expect(deleted).toEqual(["old-transcript"]);
    expect(answer.json).toMatchObject({
      posted_private_note: { notes: 1, replaced_previous: 1 },
    });
  });

  it("keeps the previous transcript when told not to replace it", async () => {
    thread.push({
      externalId: "old-transcript",
      direction: "outgoing",
      visibility: "private",
      bodyText: "turns ... [tachy:compacted-transcript]",
    });
    await call("compact_work_item", {
      source: "notes-conn",
      external_id: "n-1",
      replace_previous: false,
    });
    expect(posted).toHaveLength(1);
    expect(deleted).toEqual([]);
  });
});
