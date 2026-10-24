/**
 * get_context and fetch_work_item search a ticket by its whole thread, and a
 * later open of the same ticket embeds only the messages it has not seen.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  addSourceConnection,
  addSourceProject,
  registerSource,
} from "@tachy/core/sources";
import { saveKnowledgeEntry, searchKnowledge } from "@tachy/core/knowledge";
import * as embeddings from "../../packages/core/src/search/embeddings";
import { server } from "../../packages/mcp/src/index";
import { resetData, sql, tpdProductId } from "../database";

vi.mock("../../packages/core/src/search/embeddings", async (original) => {
  const actual = await original<typeof embeddings>();
  return { ...actual, embedQueryLiteral: vi.fn(actual.embedQueryLiteral) };
});

const embedCalls = vi.mocked(embeddings.embedQueryLiteral);

afterAll(() => sql.end());

const PROJECT = "Device Tickets";

/** The thread the fake source serves, oldest first; a test appends to it. */
let thread: string[] = [];

const OPENING =
  "Hello, our team has a question since the rollout last week. Could somebody call us back when there is time?";
const REPLY =
  "Thanks for writing in. Could you describe what you see on your side, with a screenshot if you have one?";
const SYMPTOM =
  "Since the software upgrade our handheld barcode reader shows offline, and the pairing dialog never appears.";

registerSource("fake-ticket-search", () => ({
  type: "fake-ticket-search",
  capabilities: { postNote: false, incrementalSync: false },
  async fetchItem(id: string) {
    return {
      externalId: id,
      kind: "ticket" as const,
      title: "Question after the rollout",
      groupKey: PROJECT,
      messages: thread.map((bodyText, i) => ({
        externalId: `${id}-${i + 1}`,
        direction: i % 2 ? ("outgoing" as const) : ("incoming" as const),
        visibility: "public" as const,
        bodyText,
      })),
      raw: {},
    };
  },
  async listItems() {
    return { items: [] };
  },
}));

let client: Client;
let scannerId: string;

async function call(name: string) {
  const answer = (await client.callTool({
    name,
    arguments: { source: "ticket-search", external_id: "t-1" },
  })) as { content: { text: string }[]; isError?: boolean };
  expect(answer.isError ?? false).toBe(false);
  return JSON.parse(answer.content[0]?.text ?? "{}");
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

beforeEach(async () => {
  await resetData();
  const productId = await tpdProductId();
  const scanner = await saveKnowledgeEntry({
    productId,
    status: "approved",
    issueSummary:
      "Handheld barcode reader will not connect after a software upgrade",
    symptoms: ["scanner shows offline", "no pairing dialog appears"],
    rootCause: "The upgrade reset the Bluetooth pairing table.",
    resolution:
      "Re-pair the scanner from device settings, then restart the ingest service.",
  });
  scannerId = scanner.id as string;
  await saveKnowledgeEntry({
    productId,
    status: "approved",
    issueSummary: "Monthly invoice export produces an empty PDF",
    rootCause: "The export cache retained a stale, empty render.",
    resolution: "Clear the export cache and re-run the monthly job.",
  });
  await addSourceConnection({
    sourceType: "fake-ticket-search",
    slug: "ticket-search",
    baseUrl: "https://example.invalid",
  });
  await addSourceProject({
    sourceSlug: "ticket-search",
    externalKey: PROJECT,
    productSlug: "tpd",
  });
  thread = [OPENING, REPLY, SYMPTOM];
  embedCalls.mockClear();
});

describe("searching a ticket by its whole thread", () => {
  it("finds a past entry from a symptom only a later message states", async () => {
    const context = await call("get_context");
    expect(context.similar[0]).toMatchObject({ id: scannerId });
    expect(context.similar[0].grade).not.toBe("weak");

    const fromOpening = await searchKnowledge(
      `Question after the rollout ${OPENING}`,
      { productId: await tpdProductId() },
    );
    const scanner = fromOpening.find((row) => row.id === scannerId);
    expect(scanner?.grade ?? "weak").toBe("weak");
  });

  it("embeds nothing at a second open, and finds the same", async () => {
    const first = await call("get_context");
    const windows = embedCalls.mock.calls.length;
    expect(windows).toBeGreaterThan(0);
    embedCalls.mockClear();

    const again = await call("get_context");
    expect(embedCalls).not.toHaveBeenCalled();
    expect(again.similar).toEqual(first.similar);
    expect(again.reference).toEqual(first.reference);
  });

  it("embeds only the message a ticket gained since it was opened", async () => {
    await call("get_context");
    embedCalls.mockClear();
    thread = [
      ...thread,
      "We restarted the reader twice and it still shows offline in the device list.",
    ];
    await call("get_context");
    expect(embedCalls).toHaveBeenCalledTimes(1);
  });

  it("shares the vectors between fetch_work_item and get_context", async () => {
    await call("fetch_work_item");
    expect(embedCalls.mock.calls.length).toBeGreaterThan(0);
    embedCalls.mockClear();
    await call("get_context");
    expect(embedCalls).not.toHaveBeenCalled();
  });
});
