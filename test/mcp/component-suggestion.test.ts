/**
 * fetch_work_item names the component a ticket's similar past entries agree
 * on, when no area rule picked one.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  addSourceConnection,
  addSourceProject,
  registerSource,
  setProjectAreaMap,
} from "@tachy/core/sources";
import { addComponent } from "@tachy/core/catalog";
import { saveKnowledgeEntry } from "@tachy/core/knowledge";
import { server } from "../../packages/mcp/src/index";
import { resetData, sql, tpdProductId } from "../database";

afterAll(() => sql.end());

const PROJECT = "Scanner Tickets";

/** Tickets by id: `areaPath` is what an area rule matches on. */
const TICKETS: Record<string, { body: string; areaPath?: string }> = {
  "t-unmapped": {
    body: "Since this morning every handheld logs SCAN_TIMEOUT_42 and drops its session.",
  },
  "t-mapped": {
    body: "Since this morning every handheld logs SCAN_TIMEOUT_42 and drops its session.",
    areaPath: `${PROJECT}\\Billing`,
  },
};

registerSource("fake-components", () => ({
  type: "fake-components",
  capabilities: { postNote: false, incrementalSync: false },
  async fetchItem(id: string) {
    return {
      externalId: id,
      kind: "ticket" as const,
      title: "Handhelds drop their session",
      groupKey: PROJECT,
      areaPath: TICKETS[id].areaPath,
      messages: [
        {
          externalId: `${id}-1`,
          direction: "incoming" as const,
          visibility: "public" as const,
          bodyText: TICKETS[id].body,
        },
      ],
      raw: {},
    };
  },
  async listItems() {
    return { items: [] };
  },
}));

let client: Client;

async function fetchTicket(externalId: string) {
  const answer = (await client.callTool({
    name: "fetch_work_item",
    arguments: { source: "components", external_id: externalId },
  })) as { content: { text: string }[] };
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
  await addComponent({
    productId,
    slug: "scanner-driver",
    name: "Scanner driver",
  });
  await addComponent({ productId, slug: "billing", name: "Billing" });
  for (const device of ["dock scanner", "handheld", "ring scanner"])
    await saveKnowledgeEntry({
      productId,
      status: "approved",
      component: "scanner-driver",
      issueSummary: `The ${device} drops its session with SCAN_TIMEOUT_42`,
      signals: ["SCAN_TIMEOUT_42"],
      rootCause: "The driver's keep-alive is shorter than the access point's.",
      resolution: "Raise the driver's keep-alive interval.",
    });
  await saveKnowledgeEntry({
    productId,
    status: "approved",
    component: "billing",
    issueSummary: "Invoice totals are off by a cent",
    resolution: "Round per invoice instead of per line.",
  });
  await addSourceConnection({
    sourceType: "fake-components",
    slug: "components",
    baseUrl: "https://example.invalid",
  });
  const project = await addSourceProject({
    sourceSlug: "components",
    externalKey: PROJECT,
    productSlug: "tpd",
  });
  await setProjectAreaMap({
    sourceProjectId: project.id,
    areaPrefix: `${PROJECT}\\Billing`,
    componentSlug: "billing",
  });
});

describe("fetch_work_item's component suggestion", () => {
  it("names the component similar entries agree on when no rule matched", async () => {
    const ticket = await fetchTicket("t-unmapped");
    expect(ticket).not.toHaveProperty("component");
    expect(ticket.component_suggestion).toMatchObject({
      component: "scanner-driver",
      agreeing: 3,
    });
  });

  it("suggests nothing when a rule picked the component", async () => {
    const ticket = await fetchTicket("t-mapped");
    expect(ticket.component).toBe("billing");
    expect(ticket).not.toHaveProperty("component_suggestion");
  });
});
