import {
  afterAll,
  afterEach,
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
  registerSource,
  type RawWorkItem,
} from "@tachy/core/sources";
import {
  addComponent,
  addCustomer,
  addCustomerUnit,
  setCustomerFact,
} from "@tachy/core/catalog";
import { server } from "../../packages/mcp/src/index";
import {
  capTurns,
  componentIntoFilter,
  loadContextSources,
  resolveScopeIds,
  LINKED_BODY_CHARS,
  MAX_LINKED_ITEMS,
} from "../../packages/mcp/src/context";
import { resetData, sql, tpdProductId } from "../database";

const ORG = "https://dev.azure.com/ctxorg";

let client: Client;

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

const ticket = (over: Partial<RawWorkItem> = {}): RawWorkItem => ({
  externalId: "t-1",
  kind: "ticket",
  title: "printer stops mid-batch",
  status: "open",
  requester: "ops@acme.example",
  requesterEmail: "ops@acme.example",
  messages: [
    {
      externalId: "1",
      direction: "incoming",
      visibility: "public",
      bodyText: "The printer stops mid-batch and the queue never drains.",
      author: "ops@acme.example",
    },
  ],
  raw: {},
  ...over,
});

let served: RawWorkItem = ticket();

registerSource("fake-ctx", () => ({
  type: "fake-ctx",
  capabilities: { postNote: false, incrementalSync: false },
  async fetchItem() {
    return served;
  },
  async listItems() {
    return { items: [] };
  },
  async verify() {
    return { identity: "svc@example.invalid", groups: [] };
  },
}));

const fetchTicket = async (item: RawWorkItem) => {
  served = item;
  const answer = await call("fetch_work_item", {
    source: "fake-ctx-conn",
    external_id: item.externalId,
  });
  expect(answer.isError).toBe(false);
  return answer.json as Record<string, any>;
};

beforeAll(async () => {
  process.env.AZURE_DEVOPS_TOKEN = "test-pat";
  await addSourceConnection({
    sourceType: "fake-ctx",
    slug: "fake-ctx-conn",
    baseUrl: "https://example.invalid",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

beforeEach(resetData);
afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await client.close();
  await sql`delete from source_connections where slug in ('fake-ctx-conn', 'ado-ctx')`;
  await sql.end();
});

describe("capTurns", () => {
  const turn = (n: number) => ({ text: "x".repeat(n) });

  it("returns everything, unflagged, when it fits", () => {
    expect(capTurns([turn(3), turn(4)], 10)).toEqual({
      turns: [turn(3), turn(4)],
    });
  });

  it("skips a turn that does not fit and keeps the readable ones after it", () => {
    const capped = capTurns([turn(3), turn(50), turn(4)], 10);
    expect(capped.turns).toEqual([turn(3), turn(4)]);
    expect(capped.turns_truncated).toEqual({ shown: 2, of: 3 });
  });
});

describe("who a fetched ticket is about", () => {
  it("carries the customer's own install inline once the customer is known", async () => {
    await addCustomer({
      name: "Acme",
      slug: "acme",
      emailDomains: ["acme.example"],
      notes: "Runs the on-prem build.",
    });
    await setCustomerFact({
      customerSlug: "acme",
      kind: "version",
      label: "portal",
      value: "4.2",
    });
    const body = await fetchTicket(ticket());
    expect(body.customer_name).toBe("Acme");
    expect(body).not.toHaveProperty("customer_note");
    expect(body.customer_profile).toEqual({
      slug: "acme",
      notes: "Runs the on-prem build.",
      specifics: ["version: portal: 4.2"],
    });
    expect(body.customer_profile_note).toMatch(/THIS customer's install/);
  });

  it("leaves the profile out for a customer nothing is recorded about", async () => {
    await addCustomer({
      name: "Acme",
      slug: "acme",
      emailDomains: ["acme.example"],
    });
    const body = await fetchTicket(ticket());
    expect(body.customer_name).toBe("Acme");
    expect(body).not.toHaveProperty("customer_profile");
    expect(body).not.toHaveProperty("unit_note");
  });

  it("names the unit a ticket mentions without assigning it", async () => {
    await addCustomer({
      name: "Acme",
      slug: "acme",
      emailDomains: ["acme.example"],
    });
    await addCustomerUnit({
      customerSlug: "acme",
      slug: "plant-north",
      name: "North plant",
      kind: "site",
      aliases: ["Nordwerk"],
    });
    await addCustomerUnit({
      customerSlug: "acme",
      slug: "plant-south",
      name: "South plant",
      kind: "site",
    });

    const byAlias = await fetchTicket(
      ticket({ title: "Nordwerk label printer offline" }),
    );
    expect(byAlias.unit_candidates).toEqual([
      { slug: "plant-north", name: "North plant", kind: "site" },
    ]);
    expect(byAlias.unit_note).toMatch(/'plant-north'/);
    expect(byAlias.unit_note).toMatch(/get_customer_profile/);

    const unnamed = await fetchTicket(ticket({ externalId: "t-2" }));
    expect(unnamed).not.toHaveProperty("unit_note");
  });
});

describe("Azure DevOps items a ticket points at", () => {
  const adoItem = (id: number, description: string) => ({
    id,
    _links: { html: { href: `${ORG}/ProjA/_workitems/edit/${id}` } },
    fields: {
      "System.Id": id,
      "System.Title": `Bug ${id}`,
      "System.State": "Active",
      "System.WorkItemType": "Bug",
      "System.TeamProject": "ProjA",
      "System.AreaPath": "ProjA\\Portal",
      "System.Description": description,
    },
  });

  function mockAdo(items: Record<string, unknown>) {
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = url.replace(ORG, "");
        const item = /^\/_apis\/wit\/workitems\/(\d+)\?/.exec(path);
        if (item) {
          fetched.push(item[1]);
          const answer = items[item[1]];
          if (!answer)
            return {
              ok: false,
              status: 404,
              text: async () => "work item does not exist",
            } as Response;
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify(answer),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ comments: [], value: [] }),
        } as Response;
      }),
    );
    return fetched;
  }

  const withAdoConnection = () =>
    addSourceConnection({
      sourceType: "azure-devops",
      slug: "ado-ctx",
      baseUrl: ORG,
    });

  it("adds nothing for a ticket that references none", async () => {
    const body = await fetchTicket(ticket());
    expect(body).not.toHaveProperty("linked_ado_refs");
    expect(body).not.toHaveProperty("linked_items");
  });

  it("lists the ids and says why they were not read when there is no connection", async () => {
    await sql`delete from source_connections where slug = 'ado-ctx'`;
    const body = await fetchTicket(
      ticket({ title: "printer stops, see AB#101 and DevOps#102" }),
    );
    expect(body.linked_ado_refs).toEqual(["101", "102"]);
    expect(body.linked_items_note).toMatch(/no azure-devops connection/);
    expect(body).not.toHaveProperty("linked_items");
  });

  it("reads each linked item, stores it, and links it to the ticket", async () => {
    await withAdoConnection();
    mockAdo({ "101": adoItem(101, "<p>Spooler deadlocks on reconnect.</p>") });
    const body = await fetchTicket(ticket({ title: "printer stops, AB#101" }));

    expect(body.linked_ado_refs).toEqual(["101"]);
    expect(body.linked_items).toHaveLength(1);
    expect(body.linked_items[0]).toMatchObject({
      external_id: "101",
      title: "Bug 101",
      state: "Active",
      type: "Bug",
      area_path: "ProjA\\Portal",
      url: `${ORG}/ProjA/_workitems/edit/101`,
    });
    expect(body.linked_items[0].body).toContain("Spooler deadlocks");
    expect(body.next).toMatch(/do not fetch them again/);
    expect(body).not.toHaveProperty("linked_items_note");

    const [stored] = await sql`
      select external_id from work_items where id = ${body.linked_items[0].work_item_id}
    `;
    expect(stored.external_id).toBe("101");
    const links = await sql`
      select to_external_id from work_item_links
      where from_work_item_id = ${body.work_item_id}
    `;
    expect(links.map((l) => l.to_external_id)).toEqual(["101"]);
  });

  it("reads only the first few of many, and trims a long body", async () => {
    await withAdoConnection();
    const ids = [201, 202, 203, 204, 205, 206, 207];
    const fetched = mockAdo(
      Object.fromEntries(
        ids.map((id) => [String(id), adoItem(id, "y".repeat(5000))]),
      ),
    );
    const body = await fetchTicket(
      ticket({ title: ids.map((id) => `AB#${id}`).join(" ") }),
    );
    expect(body.linked_ado_refs).toHaveLength(ids.length);
    expect(body.linked_items).toHaveLength(MAX_LINKED_ITEMS);
    expect(fetched).toEqual(["201", "202", "203", "204", "205"]);
    expect(body.linked_items_note).toMatch(/7 ids referenced; the first 5/);
    expect(body.linked_items[0].body.length).toBeLessThanOrEqual(
      LINKED_BODY_CHARS,
    );
  });

  it("reports one unreadable item without losing the others", async () => {
    await withAdoConnection();
    mockAdo({ "302": adoItem(302, "ok") });
    const body = await fetchTicket(ticket({ title: "AB#301 and AB#302" }));
    expect(body.linked_items[0]).toMatchObject({ external_id: "301" });
    expect(body.linked_items[0].error).toMatch(/404/);
    expect(body.linked_items[1]).toMatchObject({
      external_id: "302",
      title: "Bug 302",
    });
  });
});

describe("search scoping helpers", () => {
  it("resolves the slugs it is given and leaves the rest undefined", async () => {
    expect(await resolveScopeIds({})).toEqual({
      productId: undefined,
      teamId: undefined,
    });
    const scope = await resolveScopeIds({
      product_slug: "tpd",
      team_slug: "test-team",
    });
    expect(scope.productId).toBe(await tpdProductId());
    expect(scope.teamId).toBeTruthy();
  });

  it("passes tags through untouched when no component is named", async () => {
    expect(await componentIntoFilter(undefined, undefined, undefined)).toEqual({
      tags: undefined,
      componentId: undefined,
      componentTags: undefined,
    });
    expect(
      await componentIntoFilter(await tpdProductId(), undefined, ["printing"]),
    ).toMatchObject({ tags: ["printing"], componentId: undefined });
  });

  it("turns a known component into its id", async () => {
    const productId = await tpdProductId();
    const component = await addComponent({
      productId,
      slug: "label-printing",
      name: "Label printing",
    });
    const filter = await componentIntoFilter(productId, "label-printing", [
      "urgent",
    ]);
    expect(filter.componentId).toBe(component.id);
    expect(filter.tags).toEqual(["urgent"]);
  });
});

describe("loadContextSources", () => {
  it("takes inline text and ignores a blank one", async () => {
    expect(await loadContextSources({ text: "   " })).toEqual([]);
    expect(await loadContextSources({ text: "release notes" })).toEqual([
      { source: "inline", text: "release notes" },
    ]);
  });
});
