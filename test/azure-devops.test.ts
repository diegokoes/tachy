import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAzureDevopsSource } from "@tachy/source-azure-devops";
import { extractAdoRefs, TokenMap, envCredential } from "@tachy/core";
import type { RawWorkItem } from "@tachy/core";

beforeAll(() => {
  process.env.AZURE_DEVOPS_TOKEN = "test-pat";
});
afterEach(() => vi.unstubAllGlobals());

function mockFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = url.replace("https://dev.azure.com/myorg", "");
      calls.push(path);
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
  return calls;
}

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
    mockFetch({
      ...routes,
      "/ProjA/_apis/wit/wiql": { workItems: [{ id: 42 }] },
      "/_apis/wit/workitems?": { value: [workItem] },
    });
    const { items, nextCursor } = await source().listItems({});
    expect(items).toHaveLength(1);
    expect(items[0].externalId).toBe("42");
    expect(nextCursor).toBeUndefined();
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
          related: [{ id: 11, title: "contact bob@corp.example" }],
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
