import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createAzureDevopsSource,
  createAdoClient,
} from "@tachy/source-azure-devops";
import { extractAdoRefs, TokenMap, envCredential } from "@tachy/core";
import type { RawWorkItem } from "@tachy/core";

beforeAll(() => {
  process.env.AZURE_DEVOPS_TOKEN = "test-pat";
});
afterEach(() => vi.unstubAllGlobals());

function mockFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace("https://dev.azure.com/myorg", "");
      calls.push(`${init?.method ?? "GET"} ${path}`);
      if (init?.body != null) bodies.push(JSON.parse(String(init.body)));
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => path.startsWith(k));
      if (!key) throw new Error(`unexpected fetch ${path}`);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(routes[key]),
      } as Response;
    }),
  );
  return { calls, bodies };
}

const client = () =>
  createAdoClient({
    baseUrl: "https://dev.azure.com/myorg",
    slug: "ado",
    config: {},
  });

const source = () =>
  createAzureDevopsSource({
    baseUrl: "https://dev.azure.com/myorg",
    slug: "ado",
    config: { projects: ["ProjA"] },
  });

const workItem = {
  id: 42,
  _links: {
    html: { href: "https://dev.azure.com/myorg/ProjA/_workitems/edit/42" },
  },
  fields: {
    "System.Id": 42,
    "System.Title": "Printer fails with 023",
    "System.State": "Active",
    "System.TeamProject": "ProjA",
    "System.AreaPath": "ProjA\\Portal\\Printing",
    "System.WorkItemType": "Bug",
    "System.CreatedDate": "2026-01-01T00:00:00Z",
    "System.ChangedDate": "2026-01-03T00:00:00Z",
    "System.CreatedBy": {
      displayName: "Alice Dev",
      uniqueName: "alice@corp.example",
    },
    "System.Description": "<div>Printer <b>stops</b> mid-run</div>",
    "Microsoft.VSTS.TCM.ReproSteps": "<ol><li>print label</li></ol>",
    "Custom.FaultVersion": "2.4.1",
  },
  relations: [
    {
      rel: "System.LinkTypes.Hierarchy-Reverse",
      url: "https://dev.azure.com/myorg/_apis/wit/workItems/10",
    },
    {
      rel: "System.LinkTypes.Related",
      url: "https://dev.azure.com/myorg/_apis/wit/workItems/11",
    },
    {
      rel: "ArtifactLink",
      url: "vstfs:///Git/PullRequestId/projguid%2Frepoguid%2F77",
      attributes: { name: "Pull Request" },
    },
  ],
};

const routes = {
  "/_apis/wit/workitems/42": workItem,
  "/_apis/wit/workitems?": {
    value: [
      {
        id: 10,
        fields: {
          "System.Title": "Parent feature",
          "System.State": "Active",
          "System.WorkItemType": "Feature",
        },
      },
      {
        id: 11,
        fields: {
          "System.Title": "Related bug",
          "System.State": "Closed",
          "System.WorkItemType": "Bug",
        },
      },
    ],
  },
  "/ProjA/_apis/wit/workItems/42/comments": {
    comments: [
      {
        id: 1,
        text: "<div>fixed in build 55</div>",
        createdBy: { displayName: "Bob Dev" },
        createdDate: "2026-01-02T00:00:00Z",
      },
    ],
  },
  "/projguid/_apis/git/repositories/repoguid/pullrequests/77": {
    pullRequestId: 77,
    title: "Fix printer buffer",
    status: "completed",
    repository: { name: "line-controller", project: { name: "ProjA" } },
  },
};

describe("azure-devops adapter", () => {
  it("maps a work item + comments into a normalized item with relation summaries", async () => {
    mockFetch(routes);
    const item = await source().fetchItem("42");

    expect(item.externalId).toBe("42");
    expect(item.kind).toBe("work_item");
    expect(item.groupKey).toBe("ProjA");
    // The routing input for a project's area -> component rules.
    expect(item.areaPath).toBe("ProjA\\Portal\\Printing");
    expect(item.title).toBe("Printer fails with 023");
    expect(item.status).toBe("Active");
    expect(item.requesterEmail).toBe("alice@corp.example");

    const bodies = item.messages.map((m) => m.bodyText);
    expect(bodies[0]).toContain("Printer");
    expect(bodies[0]).not.toContain("<b>");
    expect(bodies.some((b) => b.startsWith("Repro steps:"))).toBe(true);
    expect(bodies.at(-1)).toBe("fixed in build 55");

    const raw = item.raw as any;
    expect(raw.fields["Custom.FaultVersion"]).toBe("2.4.1");
    expect(raw.relations.parent).toMatchObject({
      id: 10,
      title: "Parent feature",
    });
    expect(raw.relations.related).toEqual([
      expect.objectContaining({ id: 11, state: "Closed" }),
    ]);
    expect(raw.relations.pull_requests).toEqual([
      expect.objectContaining({ id: 77, title: "Fix printer buffer" }),
    ]);
  });

  it("lists items per project with a JSON cursor", async () => {
    const { calls } = mockFetch({
      ...routes,
      "/ProjA/_apis/wit/wiql": { workItems: [{ id: 42 }] },
      "/_apis/wit/workitems?": { value: [workItem] },
    });
    const { items, nextCursor } = await source().listItems({});
    expect(items).toHaveLength(1);
    expect(items[0].externalId).toBe("42");
    expect(nextCursor).toBeUndefined();
    const wiql = calls.find((c) => c.includes("/wiql"));
    expect(wiql).toContain("timePrecision=true");
    expect(wiql).toContain("%24top=200");
  });

  it("advances a ChangedDate watermark across full sync pages", async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) => i + 1);
    const value = fullPage.map((id) => ({
      id,
      fields: {
        "System.TeamProject": "ProjA",
        "System.Title": `wi ${id}`,
        "System.ChangedDate": `2026-01-01T00:${String(Math.floor(id / 60)).padStart(2, "0")}:${String(id % 60).padStart(2, "0")}.000Z`,
      },
    }));
    mockFetch({
      "/ProjA/_apis/wit/wiql": { workItems: fullPage.map((id) => ({ id })) },
      "/_apis/wit/workitems?": { value },
    });
    const { items, nextCursor } = await source().listItems({});
    expect(items).toHaveLength(200);
    expect(JSON.parse(nextCursor!)).toEqual({
      p: 0,
      since: "2026-01-01T00:03:20.000Z",
    });
  });

  it("bumps a stuck watermark by 1ms when a full page fails to advance it", async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) => i + 1);
    const value = fullPage.map((id) => ({
      id,
      fields: {
        "System.TeamProject": "ProjA",
        "System.ChangedDate": "2026-01-01T00:00:00.000Z",
      },
    }));
    mockFetch({
      "/ProjA/_apis/wit/wiql": { workItems: fullPage.map((id) => ({ id })) },
      "/_apis/wit/workitems?": { value },
    });
    const { nextCursor } = await source().listItems({
      cursor: JSON.stringify({ p: 0, since: "2026-01-01T00:00:00.000Z" }),
    });
    expect(JSON.parse(nextCursor!)).toEqual({
      p: 0,
      since: "2026-01-01T00:00:00.001Z",
    });
  });

  it("moves to the next project after a short page", async () => {
    mockFetch({
      "/ProjA/_apis/wit/wiql": { workItems: [{ id: 42 }] },
      "/_apis/wit/workitems?": { value: [workItem] },
    });
    const multi = createAzureDevopsSource({
      baseUrl: "https://dev.azure.com/myorg",
      slug: "ado",
      config: { projects: ["ProjA", "ProjB"] },
    });
    const { nextCursor } = await multi.listItems({});
    expect(JSON.parse(nextCursor!)).toEqual({ p: 1 });
  });

  it("rejects an unparseable updatedSince before querying", async () => {
    mockFetch({});
    await expect(
      source().listItems({ updatedSince: "not-a-date" }),
    ).rejects.toThrow(/invalid updatedSince/);
  });

  it("fails with a scope hint on non-JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 203,
        text: async () => "<html>Sign in</html>",
      })) as any,
    );
    await expect(source().fetchItem("42")).rejects.toThrow(/PAT/);
  });

  it("redactRaw scrubs identities and free text", () => {
    const src = source();
    const map = new TokenMap();
    const red = src.redactRaw!(
      {
        fields: {
          "System.CreatedBy": {
            displayName: "Alice Dev",
            uniqueName: "alice@corp.example",
          },
          "System.Title": "mail alice@corp.example about printer",
        },
        relations: {
          parent: { id: 10, title: "email carol@corp.example about parent" },
          related: [{ id: 11, title: "contact bob@corp.example" }],
          commits: [
            {
              sha: "abc123",
              comment: "fix reported by dave@corp.example",
              author: "Dave Dev",
            },
          ],
        },
      },
      map,
      "acme",
    ) as any;
    expect(red.fields["System.CreatedBy"].displayName).toBe("acme");
    expect(red.fields["System.CreatedBy"].uniqueName).toMatch(
      /^\[EMAIL_\d+\]$/,
    );
    expect(red.fields["System.Title"]).not.toContain("alice@corp.example");
    expect(red.relations.related[0].title).not.toContain("bob@corp.example");
    expect(red.relations.parent.title).not.toContain("carol@corp.example");
    expect(red.relations.commits[0].comment).not.toContain("dave@corp.example");
    expect(red.relations.commits[0].author).toMatch(/^\[USER_\d+\]$/);
    expect(red.relations.commits[0].sha).toBe("abc123");
  });
});

describe("azure-devops client", () => {
  it("versions every request: 7.1, except the endpoints with no released version", async () => {
    const { calls } = mockFetch({
      "/_apis/connectionData": {
        authenticatedUser: { providerDisplayName: "svc" },
      },
      "/_apis/projects": { value: [{ id: "1", name: "ProjA" }] },
      "/_apis/wit/workitems?": { value: [] },
      "/_apis/wit/workitems/42": { id: 42, fields: {} },
      "/ProjA/_apis/wit/workItems/42/comments": { comments: [] },
      "/ProjA/_apis/wit/wiql": { workItems: [] },
      "/ProjA/_apis/wit/workitemtypes/Bug/fields": { value: [] },
      "/ProjA/_apis/wit/workitemtypes": { value: [] },
      "/ProjA/_apis/wit/workitems/$Bug": { id: 99 },
      "/ProjA/_apis/git/repositories/r1/pullrequests/77": { pullRequestId: 77 },
      "/ProjA/_apis/git/repositories/r1/commits/abc": { commitId: "abc" },
      "/ProjA/_apis/git/repositories": { value: [] },
      "/ProjA/_apis/wiki/wikis/w/pages": { path: "/" },
      "/ProjA/_apis/wiki/wikis": { value: [] },
      "/_apis/wiki/wikis": { value: [] },
    });

    const c = client();
    await c.getConnectionData();
    await c.listProjects();
    await c.getWorkItem("42");
    await c.getWorkItemsBatch([42], ["System.Title"]);
    await c.getComments("ProjA", "42");
    await c.queryWorkItemIds("ProjA", "2026-01-01T00:00:00Z", 50);
    await c.getPullRequest("ProjA", "r1", "77");
    await c.getCommit("ProjA", "r1", "abc");
    await c.listWorkItemTypes("ProjA");
    await c.getTypeFields("ProjA", "Bug");
    await c.createWorkItem("ProjA", "Bug", []);
    await c.listWikis("ProjA");
    await c.listWikis();
    await c.listWikiPages("ProjA", "w");
    await c.getWikiPage("ProjA", "w", "/Home/Setup");
    await c.listRepos("ProjA");

    expect(calls.length).toBe(16);
    for (const call of calls) {
      const versions = [...call.matchAll(/api-version=([^&\s]+)/g)].map(
        (m) => m[1],
      );
      expect(versions, call).toHaveLength(1);
      const expected = call.includes("/comments")
        ? "7.1-preview.4"
        : call.includes("/connectionData")
          ? "7.1-preview.1"
          : "7.1";
      expect(versions[0], call).toBe(expected);
    }
  });

  it("leaves ADO's own query operators and encoded wiki paths untouched", async () => {
    const { calls } = mockFetch({
      "/ProjA/_apis/wiki/wikis/w/pages": { path: "/" },
    });
    await client().getWikiPage("ProjA", "w", "/Home/Setup Guide");
    expect(calls[0]).toContain("path=%2FHome%2FSetup+Guide");
    expect(calls[0]).toContain("includeContent=true");
    expect(calls[0]).toContain("api-version=7.1");
  });

  it("creates work items under the project path with the json-patch body", async () => {
    const { calls, bodies } = mockFetch({
      "/ProjA/_apis/wit/workitems/$Bug": { id: 99 },
    });
    const patch = [
      { op: "add" as const, path: "/fields/System.Title", value: "boom" },
    ];
    const created = await client().createWorkItem("ProjA", "Bug", patch);
    expect(created.id).toBe(99);
    expect(calls).toContain(
      "POST /ProjA/_apis/wit/workitems/$Bug?api-version=7.1",
    );
    expect(bodies[0]).toEqual(patch);
  });

  it("treats empty bodies as {} and reserves the PAT hint for auth statuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 204,
        text: async () => "",
      })) as any,
    );
    await expect(client().getWorkItem("1")).resolves.toEqual({});

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        text: async () => '{"message":"work item does not exist"}',
      })) as any,
    );
    const err = await client()
      .getWorkItem("1")
      .catch((e: Error) => e);
    expect(err.message).toContain("404");
    expect(err.message).toContain("work item does not exist");
    expect(err.message).not.toContain("PAT");
  });
});

describe("extractAdoRefs", () => {
  const base: RawWorkItem = {
    externalId: "1",
    kind: "ticket",
    raw: {},
    messages: [],
  };

  it("finds refs in custom field, text mentions, and URLs", () => {
    const refs = extractAdoRefs({
      ...base,
      title: "printer down, see AB#158327",
      raw: { custom_fields: { cf_devops_work_item: "50912" } },
      messages: [
        {
          visibility: "public",
          direction: "incoming",
          bodyText:
            "tracked in DevOps#777 and https://dev.azure.com/myorg/ProjA/_workitems/edit/888",
        },
      ],
    });
    expect(refs).toEqual(
      expect.arrayContaining(["50912", "158327", "777", "888"]),
    );
    expect(refs).toHaveLength(4);
  });

  it("returns nothing for azure-devops items themselves", () => {
    expect(
      extractAdoRefs({ ...base, kind: "work_item", title: "AB#123" }),
    ).toEqual([]);
  });
});

describe("azure-devops credentials", () => {
  it("resolves hyphenated source-token names from env", () => {
    process.env.AZURE_DEVOPS_TOKEN_MY_ADO = "pat-123";
    try {
      expect(envCredential("azure-devops_token:my-ado")).toBe("pat-123");
    } finally {
      delete process.env.AZURE_DEVOPS_TOKEN_MY_ADO;
    }
  });
});
