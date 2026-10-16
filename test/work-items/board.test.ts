import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { addSourceConnection, addSourceProject } from "@tachy/core/sources";
import { addTeam } from "@tachy/core/catalog";
import {
  clearPermissionCache,
  createUser,
  setTeamMember,
} from "@tachy/core/access";
import { clearTypeLists, listWiql } from "@tachy/source-azure-devops";
import type { WorkItemPage, WorkItemView } from "@tachy/contract";
import { createApp } from "../../packages/api/src/app";
import { loginCookie } from "../http";
import { resetData, sql } from "../database";

const ORG = "https://dev.azure.com/boardorg";

/** Longest matching prefix answers; an Error answers 404 with its message. */
function mockAdo(routes: Record<string, unknown>) {
  const paths: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = url.replace(ORG, "");
      paths.push(path);
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
  return paths;
}

const bugType = {
  name: "Bug",
  referenceName: "Microsoft.VSTS.WorkItemTypes.Bug",
  color: "CC293D",
  icon: { id: "icon_insect" },
};

const workItem = (id: number, title: string) => ({
  id,
  fields: {
    "System.Title": title,
    "System.WorkItemType": "Bug",
    "System.State": "Active",
    "System.TeamProject": "ProjA",
    "System.AssignedTo": { displayName: "Ben", uniqueName: "ben@x.io" },
    "System.CreatedDate": "2026-10-01T08:00:00Z",
    "System.ChangedDate": "2026-10-02T08:00:00Z",
  },
});

describe("listWiql", () => {
  const query = {
    sort: "changed" as const,
    direction: "desc" as const,
    scope: "all" as const,
    offset: 0,
    limit: 50,
  };

  it("orders by the source's own field", () => {
    expect(listWiql(query)).toBe(
      "Select [System.Id] From WorkItems Where [System.TeamProject] = @project Order By [System.ChangedDate] Desc",
    );
    expect(listWiql({ ...query, sort: "created", direction: "asc" })).toMatch(
      /Order By \[System.CreatedDate\] Asc$/,
    );
  });

  it("narrows to the reader's items and doubles quotes in literals", () => {
    const wiql = listWiql({
      ...query,
      scope: "assigned",
      type: "Bug",
      state: "Won't fix",
      text: "it's blank",
    });
    expect(wiql).toContain("[System.AssignedTo] = @Me");
    expect(wiql).toContain("[System.WorkItemType] = 'Bug'");
    expect(wiql).toContain("[System.State] = 'Won''t fix'");
    expect(wiql).toContain("[System.Title] Contains 'it''s blank'");
  });

  it("matches digits against the id too", () => {
    expect(listWiql({ ...query, scope: "created", text: "42" })).toContain(
      "[System.CreatedBy] = @Me And ([System.Id] = 42 Or [System.Title] Contains '42')",
    );
  });
});

describe("/api/work-items/projects", () => {
  const app = createApp({ passwordAuth: true });
  let memberCookie: string;
  let outsiderCookie: string;
  let projectId: string;

  const get = (cookie: string, path: string) =>
    app.request(`/api/work-items/projects/${projectId}${path}`, {
      headers: { cookie },
    });

  beforeAll(async () => {
    process.env.AZURE_DEVOPS_TOKEN_ADO_BOARD = "test-pat";
    await resetData();
    clearPermissionCache();
    await addSourceConnection({
      sourceType: "azure-devops",
      slug: "ado-board",
      baseUrl: ORG,
    });
    await addTeam("elsewhere", "Elsewhere");
    projectId = (
      await addSourceProject({
        sourceSlug: "ado-board",
        externalKey: "ProjA",
        teamSlug: "test-team",
      })
    ).id;
    await createUser({
      email: "dev@example.com",
      role: "member",
      password: "dev-password",
    });
    await createUser({
      email: "out@example.com",
      role: "member",
      password: "out-password",
    });
    await setTeamMember("test-team", "dev@example.com", "member");
    await setTeamMember("elsewhere", "out@example.com", "member");
    memberCookie = await loginCookie(app, "dev@example.com", "dev-password");
    outsiderCookie = await loginCookie(app, "out@example.com", "out-password");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearTypeLists();
  });

  afterAll(async () => {
    delete process.env.AZURE_DEVOPS_TOKEN_ADO_BOARD;
    await sql`delete from source_connections where slug = 'ado-board'`;
    await sql.end();
  });

  it("lists a page in the query's order, with the type's glyph", async () => {
    mockAdo({
      "/ProjA/_apis/wit/wiql": { workItems: [{ id: 7 }, { id: 3 }, { id: 9 }] },
      "/_apis/wit/workitems?": {
        value: [workItem(3, "Second"), workItem(7, "First")],
      },
      "/ProjA/_apis/wit/workitemtypes": { value: [bugType] },
    });
    const response = await get(memberCookie, "/items?limit=2&sort=created");
    const page = (await response.json()) as WorkItemPage;
    expect(page.total).toBe(3);
    expect(page.capped).toBe(false);
    expect(page.items.map((item) => item.title)).toEqual(["First", "Second"]);
    expect(page.items[0]).toMatchObject({
      id: "7",
      icon: "icon_insect",
      color: "CC293D",
      assigned_to: "Ben",
      url: `${ORG}/ProjA/_workitems/edit/7`,
    });
  });

  it("refuses another team's project before calling the source", async () => {
    const paths = mockAdo({});
    expect((await get(outsiderCookie, "/items")).status).toBe(403);
    expect(paths).toEqual([]);
  });

  it("refuses a sort the source has no field for", async () => {
    mockAdo({});
    expect((await get(memberCookie, "/items?sort=priority")).status).toBe(400);
  });

  it("reads an item whole, stores it, and lays it out as the form does", async () => {
    mockAdo({
      "/_apis/wit/workitems/42?": {
        ...workItem(42, "Print preview is blank"),
        rev: 3,
        fields: {
          ...workItem(42, "").fields,
          "System.Title": "Print preview is blank",
          "System.Description": "<p>Blank page</p>",
          "Custom.ApprovalDate": "2026-10-03T08:00:00Z",
        },
        relations: [],
      },
      "/ProjA/_apis/wit/workItems/42/comments": {
        comments: [
          {
            id: 1,
            text: "<p>Seen on prod</p>",
            createdBy: { displayName: "Ana" },
            createdDate: "2026-10-02T09:00:00Z",
          },
        ],
      },
      "/_apis/wit/workItems/42/updates": { value: [] },
      "/ProjA/_apis/wit/workitemtypes/Bug/fields": {
        value: [
          { referenceName: "System.Description", name: "Description" },
          { referenceName: "Custom.ApprovalDate", name: "Approval date" },
        ],
      },
      "/ProjA/_apis/wit/workitemtypes": { value: [bugType] },
      "/_apis/wit/fields": {
        value: [
          {
            referenceName: "System.Description",
            name: "Description",
            type: "html",
          },
          {
            referenceName: "Custom.ApprovalDate",
            name: "Approval date",
            type: "dateTime",
          },
        ],
      },
      "/_apis/projects/ProjA": new Error("no project read"),
    });
    const response = await get(memberCookie, "/items/42");
    expect(response.status).toBe(200);
    const view = (await response.json()) as WorkItemView;
    expect(view.item).toMatchObject({
      id: "42",
      title: "Print preview is blank",
      icon: "icon_insect",
    });
    expect(view.layout).toEqual({
      layout: null,
      fields: {
        "System.Description": { name: "Description", type: "html" },
        "Custom.ApprovalDate": { name: "Approval date", type: "dateTime" },
      },
    });
    expect(view.fields["Custom.ApprovalDate"]).toBe("2026-10-03T08:00:00Z");
    expect(view.relations.children).toEqual([]);
    const said = view.timeline.filter((entry) => entry.kind === "message");
    expect(said.map((entry) => entry.text)).toEqual([
      "Blank page",
      "Seen on prod",
    ]);
    const [stored] =
      await sql`select id from work_items where external_id = '42'`;
    expect(view.stored_id).toBe(stored.id);
  });

  it("says when the item is not there", async () => {
    mockAdo({ "/_apis/wit/workitems/77?": new Error("TF401232: not found") });
    expect((await get(memberCookie, "/items/77")).status).toBe(404);
  });
});
