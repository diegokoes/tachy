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
import { addSourceConnection, addSourceProject } from "@tachy/core/sources";
import { server } from "../../packages/mcp/src/index";
import { resetData, sql } from "../database";

const ORG = "https://dev.azure.com/mcporg";

let client: Client;

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

/** Longest matching prefix answers; an Error value answers with a 404. */
function mockFetch(routes: Record<string, unknown>) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = decodeURIComponent(url.replace(ORG, "")).replace(/\+/g, " ");
      calls.push({
        method: init?.method ?? "GET",
        path,
        ...(typeof init?.body === "string"
          ? { body: JSON.parse(init.body) }
          : {}),
      });
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => path.startsWith(k));
      if (!key) throw new Error(`unexpected fetch ${path}`);
      const answer = routes[key];
      if (answer instanceof Error)
        return {
          ok: false,
          status: 404,
          text: async () => answer.message,
        } as Response;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(answer),
      } as Response;
    }),
  );
  return calls;
}

const registerProject = (
  wikis: { identifier: string; name?: string; default?: boolean }[] = [],
  config: Record<string, unknown> = {},
) =>
  addSourceProject({
    sourceSlug: "ado-mcp",
    externalKey: "ProjA",
    productSlug: "tpd",
    wikis,
    config,
  });

beforeAll(async () => {
  process.env.AZURE_DEVOPS_TOKEN = "test-pat";
  await addSourceConnection({
    sourceType: "azure-devops",
    slug: "ado-mcp",
    baseUrl: ORG,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(b), client.connect(a)]);
});

beforeEach(resetData);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await client.close();
  await sql`delete from source_connections where slug = 'ado-mcp'`;
  await sql.end();
});

describe("which connection and project a call reaches", () => {
  it("refuses a connection that is not Azure DevOps", async () => {
    vi.stubEnv("FRESHDESK_TOKEN", "test-key");
    const res = await call("list_ado_wikis", {
      source: "test-freshdesk",
      project: "ProjA",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/needs an azure-devops connection/);
  });

  it("takes source and project as given, registered or not", async () => {
    const calls = mockFetch({
      "/Unregistered/_apis/wiki/wikis": {
        value: [{ id: "w1", name: "Unregistered.wiki", type: "projectWiki" }],
      },
    });
    const res = await call("list_ado_wikis", {
      source: "ado-mcp",
      project: "Unregistered",
    });
    expect(res.json).toEqual([
      {
        id: "w1",
        name: "Unregistered.wiki",
        type: "projectWiki",
        project: "Unregistered",
      },
    ]);
    expect(calls).toHaveLength(1);
  });

  it("resolves a product to its registered project", async () => {
    await registerProject();
    const calls = mockFetch({ "/ProjA/_apis/wiki/wikis": { value: [] } });
    const res = await call("list_ado_wikis", {
      source: "ado-mcp",
      product_slug: "tpd",
    });
    expect(res.isError).toBe(false);
    expect(calls[0].path).toMatch(/^\/ProjA\/_apis\/wiki\/wikis/);
  });

  it("says so when a product has no project on that connection", async () => {
    const res = await call("list_ado_wiki_pages", {
      source: "ado-mcp",
      product_slug: "tpd",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/No registered project matches/);
  });
});

describe("list_ado_wiki_pages", () => {
  const tree = {
    path: "/",
    subPages: [
      { path: "/Home", subPages: [{ path: "/Home/Setup" }] },
      { path: "/Runbooks" },
    ],
  };

  it("uses the project's default wiki when none is named", async () => {
    await registerProject([
      { identifier: "other.wiki", name: "Other" },
      { identifier: "main.wiki", name: "Main", default: true },
    ]);
    const calls = mockFetch({ "/ProjA/_apis/wiki/wikis/main.wiki": tree });
    const res = await call("list_ado_wiki_pages", {
      source: "ado-mcp",
      product_slug: "tpd",
    });
    expect(res.json).toMatchObject({
      wiki: "main.wiki",
      total: 4,
      truncated: false,
      pages: ["/", "/Home", "/Home/Setup", "/Runbooks"],
    });
    expect(calls).toHaveLength(1);
  });

  it("finds a registered wiki by its friendly name", async () => {
    await registerProject([
      { identifier: "other.wiki", name: "Other" },
      { identifier: "main.wiki", name: "Main", default: true },
    ]);
    mockFetch({ "/ProjA/_apis/wiki/wikis/other.wiki": tree });
    const res = await call("list_ado_wiki_pages", {
      source: "ado-mcp",
      product_slug: "tpd",
      wiki: "Other",
    });
    expect(res.json).toMatchObject({ wiki: "other.wiki" });
  });

  it("passes an unregistered wiki through as given", async () => {
    mockFetch({ "/ProjA/_apis/wiki/wikis/adhoc": tree });
    const res = await call("list_ado_wiki_pages", {
      source: "ado-mcp",
      project: "ProjA",
      wiki: "adhoc",
    });
    expect(res.json).toMatchObject({ wiki: "adhoc", total: 4 });
  });

  it("asks for a wiki when there is none to fall back on", async () => {
    const res = await call("list_ado_wiki_pages", {
      source: "ado-mcp",
      project: "ProjA",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/call list_ado_wikis/);
  });

  it("narrows by prefix, and says how to see the rest when it truncates", async () => {
    mockFetch({ "/ProjA/_apis/wiki/wikis/w": tree });
    const narrowed = await call("list_ado_wiki_pages", {
      source: "ado-mcp",
      project: "ProjA",
      wiki: "w",
      path_prefix: "/Home",
    });
    expect(narrowed.json).toMatchObject({
      total: 2,
      pages: ["/Home", "/Home/Setup"],
    });
    expect(narrowed.json).not.toHaveProperty("next");

    const capped = await call("list_ado_wiki_pages", {
      source: "ado-mcp",
      project: "ProjA",
      wiki: "w",
      limit: 2,
    });
    expect(capped.json).toMatchObject({
      total: 4,
      truncated: true,
      pages: ["/", "/Home"],
    });
    expect((capped.json as { next: string }).next).toMatch(/path_prefix/);
  });
});

describe("get_ado_wiki_page", () => {
  it("needs a path or a page id", async () => {
    const res = await call("get_ado_wiki_page", {
      source: "ado-mcp",
      project: "ProjA",
      wiki: "w",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/path or page_id/);
  });

  it("returns the page with what a save needs to supersede it later", async () => {
    const project = await registerProject([
      { identifier: "main.wiki", default: true },
    ]);
    mockFetch({
      "/ProjA/_apis/wiki/wikis/main.wiki/pages": {
        path: "/Runbooks",
        content: "# Runbooks\nRestart the spooler.",
        remoteUrl: `${ORG}/ProjA/_wiki/wikis/main.wiki?pagePath=/Runbooks`,
      },
    });
    const res = await call("get_ado_wiki_page", {
      source: "ado-mcp",
      product_slug: "tpd",
      path: "/Runbooks",
    });
    expect(res.json).toMatchObject({
      path: "/Runbooks",
      external_key: "/Runbooks",
      source_project_id: project.id,
      product_slug: "tpd",
      truncated: false,
      content: "# Runbooks\nRestart the spooler.",
    });
    expect((res.json as { next: string }).next).toMatch(/remote_url/);
    expect(res.json).not.toHaveProperty("redaction");
  });

  it("fetches by the id a wiki URL carries", async () => {
    const calls = mockFetch({
      "/ProjA/_apis/wiki/wikis/w/pages/1648": {
        path: "/Start",
        content: "hello",
      },
    });
    const res = await call("get_ado_wiki_page", {
      source: "ado-mcp",
      project: "ProjA",
      wiki: "w",
      page_id: 1648,
    });
    expect(res.json).toMatchObject({
      path: "/Start",
      content: "hello",
      remote_url: null,
      source_project_id: null,
    });
    expect(calls).toHaveLength(1);
  });

  it("recovers the real path from the dashed form a browser URL gives", async () => {
    const calls = mockFetch({
      "/ProjA/_apis/wiki/wikis/w/pages?path=/Customer-specific-(processes)":
        new Error("page not found"),
      "/ProjA/_apis/wiki/wikis/w/pages?path=/&recursionLevel=full": {
        path: "/",
        subPages: [{ path: "/Customer specific (processes)" }],
      },
      "/ProjA/_apis/wiki/wikis/w/pages?path=/Customer specific (processes)": {
        path: "/Customer specific (processes)",
        content: "found",
      },
    });
    const res = await call("get_ado_wiki_page", {
      source: "ado-mcp",
      project: "ProjA",
      wiki: "w",
      path: "/Customer-specific-(processes)",
    });
    expect(res.json).toMatchObject({
      path: "/Customer specific (processes)",
      content: "found",
    });
    expect(calls).toHaveLength(3);
  });

  it("reports the original miss when no page matches the dashed form either", async () => {
    mockFetch({
      "/ProjA/_apis/wiki/wikis/w/pages?path=/Nope": new Error("page not found"),
      "/ProjA/_apis/wiki/wikis/w/pages?path=/&recursionLevel=full": {
        path: "/",
        subPages: [{ path: "/Home" }],
      },
    });
    const res = await call("get_ado_wiki_page", {
      source: "ado-mcp",
      project: "ProjA",
      wiki: "w",
      path: "/Nope",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/404/);
  });

  it("cuts a long page at max_chars and reports the full length", async () => {
    mockFetch({
      "/ProjA/_apis/wiki/wikis/w/pages": {
        path: "/Big",
        content: "abcdefghij",
      },
    });
    const res = await call("get_ado_wiki_page", {
      source: "ado-mcp",
      project: "ProjA",
      wiki: "w",
      path: "/Big",
      max_chars: 4,
    });
    expect(res.json).toMatchObject({
      chars: 10,
      truncated: true,
      content: "abcd",
    });
  });

  it("scrubs the page when the connection has redaction on", async () => {
    await sql`
      update source_connections
      set config = '{"redaction":{"enabled":true}}'::jsonb
      where slug = 'ado-mcp'
    `;
    try {
      mockFetch({
        "/ProjA/_apis/wiki/wikis/w/pages": {
          path: "/Contacts",
          content: "Escalate to jane.doe@example.invalid",
        },
      });
      const res = await call("get_ado_wiki_page", {
        source: "ado-mcp",
        project: "ProjA",
        wiki: "w",
        path: "/Contacts",
      });
      const page = res.json as { content: string; redaction: string };
      expect(page.content).not.toContain("jane.doe@example.invalid");
      expect(page.content).toMatch(/\[EMAIL_1\]/);
      expect(page.redaction).toMatch(/never guess the originals/);
    } finally {
      await sql`
        update source_connections set config = '{}'::jsonb where slug = 'ado-mcp'
      `;
    }
  });
});

describe("get_ado_work_item_schema", () => {
  it("lists the project's types when none is asked for", async () => {
    mockFetch({
      "/ProjA/_apis/wit/workitemtypes": {
        value: [
          {
            name: "Bug",
            referenceName: "Microsoft.VSTS.WorkItemTypes.Bug",
            description: "A defect",
          },
          { name: "Task", referenceName: "Microsoft.VSTS.WorkItemTypes.Task" },
        ],
      },
    });
    const res = await call("get_ado_work_item_schema", {
      source: "ado-mcp",
      project: "ProjA",
    });
    expect(res.json).toMatchObject({
      work_item_types: [
        {
          name: "Bug",
          reference_name: "Microsoft.VSTS.WorkItemTypes.Bug",
          description: "A defect",
        },
        {
          name: "Task",
          reference_name: "Microsoft.VSTS.WorkItemTypes.Task",
          description: null,
        },
      ],
    });
    expect((res.json as { next: string }).next).toMatch(/with type/);
  });

  it("returns a type's fields with the registered project's defaults", async () => {
    await registerProject([], {
      defaults: { Bug: { "System.AreaPath": "ProjA\\Portal" } },
    });
    mockFetch({
      "/ProjA/_apis/wit/workitemtypes/Bug/fields": {
        value: [
          {
            referenceName: "System.Title",
            name: "Title",
            alwaysRequired: true,
          },
        ],
      },
      "/_apis/wit/fields": { value: [] },
    });
    const res = await call("get_ado_work_item_schema", {
      source: "ado-mcp",
      product_slug: "tpd",
      type: "Bug",
    });
    const schema = res.json as {
      project: string;
      type: string;
      fields: { reference_name: string }[];
      config_defaults: Record<string, unknown>;
    };
    expect(schema).toMatchObject({ project: "ProjA", type: "Bug" });
    expect(schema.fields.map((f) => f.reference_name)).toEqual([
      "System.Title",
    ]);
    expect(schema.config_defaults).toEqual({
      "System.AreaPath": "ProjA\\Portal",
    });
  });
});

describe("create_ado_work_item", () => {
  it("creates the item with the project's defaults underneath the given fields", async () => {
    await registerProject([], {
      defaults: {
        Bug: {
          "System.AreaPath": "ProjA\\Portal",
          "Microsoft.VSTS.Common.Severity": "3 - Medium",
        },
      },
    });
    const calls = mockFetch({
      "/ProjA/_apis/wit/workitems/$Bug": {
        id: 501,
        _links: { html: { href: `${ORG}/ProjA/_workitems/edit/501` } },
      },
    });
    const res = await call("create_ado_work_item", {
      source: "ado-mcp",
      product_slug: "tpd",
      type: "Bug",
      title: "Printer stops mid-batch",
      fields: { "Microsoft.VSTS.Common.Severity": "2 - High" },
      tags: ["printing"],
    });
    expect(res.json).toEqual({
      created: true,
      id: 501,
      url: `${ORG}/ProjA/_workitems/edit/501`,
    });

    const patch = calls[0].body as { path: string; value: unknown }[];
    const field = (ref: string) =>
      patch.find((p) => p.path === `/fields/${ref}`)?.value;
    expect(calls[0].method).toBe("POST");
    expect(field("System.Title")).toBe("Printer stops mid-batch");
    expect(field("System.AreaPath")).toBe("ProjA\\Portal");
    expect(field("Microsoft.VSTS.Common.Severity")).toBe("2 - High");
    expect(field("System.Tags")).toBe("printing");
  });

  it("records what tracks the ticket it was raised from", async () => {
    const project = await registerProject();
    const [ticket] = await sql`
      insert into work_items (source_connection_id, external_id, kind, title)
      select id, 'T-1', 'ticket', 'printer' from source_connections
      where slug = 'test-freshdesk'
      returning id
    `;
    mockFetch({ "/ProjA/_apis/wit/workitems/$Task": { id: 77 } });
    const res = await call("create_ado_work_item", {
      source: "ado-mcp",
      product_slug: "tpd",
      type: "Task",
      title: "Follow up",
      work_item_id: ticket.id,
    });
    expect(res.json).toEqual({
      created: true,
      id: 77,
      linked_to_work_item: ticket.id,
      url: `${ORG}/ProjA/_workitems/edit/77`,
    });
    const links = await sql`
      select to_source_project_id, to_external_id, kind
      from work_item_links where from_work_item_id = ${ticket.id}
    `;
    expect(links).toEqual([
      {
        to_source_project_id: project.id,
        to_external_id: "77",
        kind: "tracked_by",
      },
    ]);
  });

  it("refuses a product whose project is not on Azure DevOps", async () => {
    const res = await call("create_ado_work_item", {
      source: "test-freshdesk",
      product_slug: "tpd",
      type: "Bug",
      title: "x",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/needs azure-devops/);
  });
});
