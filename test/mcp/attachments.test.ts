/**
 * A ticket's files through the tools: listed on a read of the ticket, opened
 * by reference from the source, and held to that connection's redaction.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import sharp from "sharp";
import {
  addSourceConnection,
  registerSource,
  type RawWorkItem,
  type WorkItemSource,
} from "@tachy/core/sources";
import { server } from "../../packages/mcp/src/index";
import { resetData, sql } from "../database";
import { picture } from "../fixtures/files";

afterAll(() => sql.end());

const SCREEN = "attachment:files-conn/tk-1/900";
const LOG = "attachment:files-conn/tk-1/901";

const ticket: RawWorkItem = {
  externalId: "tk-1",
  kind: "ticket",
  title: "label printer stops",
  raw: {},
  messages: [
    {
      externalId: "1",
      authorLabel: "ana.ops@example.com",
      visibility: "public",
      direction: "incoming",
      bodyText: "It stops mid-batch, see the screenshot and the log.",
      createdAt: "2026-03-04T05:06:00Z",
      attachments: [
        { id: "900", name: "screen.png", contentType: "image/png" },
        { id: "901", name: "from ana.ops@example.com.log", sizeBytes: 40 },
      ],
    },
  ],
};

let screen: Uint8Array;
const log = new TextEncoder().encode("ERROR timeout, mail ana.ops@example.com");

const body = (bytes: Uint8Array) => new Response(bytes).body!;

const listing: Omit<WorkItemSource, "type"> = {
  capabilities: { postNote: false, incrementalSync: false },
  fetchItem: async () => ticket,
  listItems: async () => ({ items: [] }),
};

registerSource("fake-files", () => ({
  ...listing,
  type: "fake-files",
  async openAttachment(_externalId, attachmentId) {
    if (attachmentId === "900")
      return { name: "screen.png", body: body(screen) };
    if (attachmentId === "901") return { name: "app.log", body: body(log) };
    throw new Error(`tk-1 lists no file '${attachmentId}'`);
  },
}));
registerSource("fake-listing", () => ({ ...listing, type: "fake-listing" }));

let client: Client;

type Block = { type: string; text?: string; data?: string };

async function call(name: string, args: Record<string, unknown>) {
  const answer = (await client.callTool({ name, arguments: args })) as {
    content: Block[];
    isError?: boolean;
  };
  const text = answer.content[0]?.text ?? "";
  return {
    isError: answer.isError === true,
    text,
    json: (text.startsWith("{") ? JSON.parse(text) : {}) as Record<string, any>,
    images: answer.content.filter((block) => block.type === "image"),
  };
}

const setRedaction = (
  redaction: { enabled: boolean; images?: boolean } | null,
) =>
  sql`update source_connections
      set config = ${sql.json(redaction ? { redaction } : {})}
      where slug = 'files-conn'`;

beforeAll(async () => {
  screen = await picture(2400, 1200);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});
afterAll(() => client.close());

beforeEach(async () => {
  await resetData();
  await addSourceConnection({
    sourceType: "fake-files",
    slug: "files-conn",
    baseUrl: "https://example.invalid",
  });
  await addSourceConnection({
    sourceType: "fake-listing",
    slug: "listing-conn",
    baseUrl: "https://example.invalid",
  });
});

describe("a read of a ticket", () => {
  it("lists its files with a reference each, and says none was read", async () => {
    for (const tool of ["fetch_work_item", "get_context"]) {
      const read = await call(tool, {
        source: "files-conn",
        external_id: "tk-1",
      });
      expect(read.isError, tool).toBe(false);
      expect(read.json.files).toEqual([
        {
          name: "screen.png",
          type: "image/png",
          from: "ana.ops@example.com",
          at: "2026-03-04T05:06:00Z",
          path: SCREEN,
        },
        {
          name: "from ana.ops@example.com.log",
          size_bytes: 40,
          from: "ana.ops@example.com",
          at: "2026-03-04T05:06:00Z",
          path: LOG,
        },
      ]);
      expect(read.json.files_note).toMatch(/none of them has been read/);
    }
  });

  it("lists them after a compaction too, for the chat to show", async () => {
    const compacted = await call("compact_work_item", {
      source: "files-conn",
      external_id: "tk-1",
      post_note: false,
    });
    expect(compacted.json.files).toHaveLength(2);
    expect(compacted.json.files[0].path).toBe(SCREEN);
  });

  it("gives no reference when the source opens no files, and says so", async () => {
    const read = await call("fetch_work_item", {
      source: "listing-conn",
      external_id: "tk-1",
    });
    expect(read.json.files).toHaveLength(2);
    expect(read.json.files[0].path).toBeUndefined();
    expect(read.json.files_note).toMatch(/cannot be opened from here/);
  });

  it("scrubs a file's name under the connection's redaction", async () => {
    await setRedaction({ enabled: true });
    const read = await call("fetch_work_item", {
      source: "files-conn",
      external_id: "tk-1",
    });
    expect(read.json.files[1].name).toBe("from [EMAIL_1].log");
    expect(read.json.files[1].path).toBe(LOG);
  });
});

describe("reading a ticket's file", () => {
  it("shows an image, fitted, and returns a log as text", async () => {
    const image = await call("read_file", { path: SCREEN });
    expect(image.json).toMatchObject({ file: "screen.png", width_px: 2000 });
    const sent = await sharp(
      Buffer.from(image.images[0].data!, "base64"),
    ).metadata();
    expect([sent.width, sent.height]).toEqual([2000, 1000]);

    const text = await call("read_file", { path: LOG, match: ["error"] });
    expect(text.json).toMatchObject({ file: "app.log", matched_lines: 1 });
    expect(text.json.text).toContain("ERROR timeout");
    expect(text.json.redaction).toBeUndefined();
  });

  it("withholds the image and scrubs the text under the connection's redaction", async () => {
    await setRedaction({ enabled: true });
    const image = await call("read_file", { path: SCREEN });
    expect(image.images).toHaveLength(0);
    expect(image.json.note).toMatch(/withheld: PII redaction is on/);
    // A ticket's file: the switch is its connection's.
    expect(image.json.note).toMatch(/this connection in console > sources/);

    const text = await call("read_file", { path: LOG });
    expect(text.json.text).toBe("ERROR timeout, mail [EMAIL_1]");
    expect(text.json.redaction).toMatch(/intentional redactions/);
  });

  it("shows the image again once the connection allows images", async () => {
    await setRedaction({ enabled: true, images: true });
    expect((await call("read_file", { path: SCREEN })).images).toHaveLength(1);
    // The organisation's switch is for files with no connection behind them.
    await setRedaction({ enabled: true });
    process.env.TACHY_REDACT_IMAGES = "true";
    try {
      expect((await call("read_file", { path: SCREEN })).images).toHaveLength(
        0,
      );
    } finally {
      delete process.env.TACHY_REDACT_IMAGES;
    }
  });

  it("reads one through ingest_context as well, under the same redaction", async () => {
    await setRedaction({ enabled: true });
    const loaded = await call("ingest_context", { paths: [SCREEN, LOG] });
    expect(loaded.images).toHaveLength(0);
    expect(loaded.json.sources[0].note).toMatch(/console > sources/);
    expect(loaded.json.sources[1].text).toBe("ERROR timeout, mail [EMAIL_1]");
    expect(loaded.json.redaction).toMatch(/intentional redactions/);
  });

  it("keeps an image off a ticket in the library", async () => {
    const kept = await call("save_library_image", {
      path: SCREEN,
      alt: "The printer's error dialog",
    });
    expect(kept.isError).toBe(false);
    expect(kept.json.markdown).toMatch(
      /^!\[The printer's error dialog\]\(\/api\/library\/assets\//,
    );
  });

  it("answers what cannot be opened as a tool error", async () => {
    for (const [path, message] of [
      ["attachment:files-conn/tk-1/999", /lists no file '999'/],
      ["attachment:listing-conn/tk-1/900", /cannot be opened from here/],
      ["attachment:no-such-conn/tk-1/900", /unknown source/],
    ] as const) {
      const refused = await call("read_file", { path });
      expect(refused.isError, path).toBe(true);
      expect(refused.text).toMatch(message);
    }
  });
});
