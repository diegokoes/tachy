import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { FieldSpec } from "@tachy/core";
import {
  addSourceConnection,
  addSourceProject,
  addTeam,
  clearPermissionCache,
  createUser,
  setTeamMember,
} from "@tachy/core";
import {
  composerForm,
  creatableTypes,
  createAdoClient,
  createWorkItem,
  explainAdoError,
  fieldPath,
  flattenTree,
  projectLayout,
  referencedKeys,
  rewriteAttachments,
} from "@tachy/source-azure-devops";
import { createApp } from "../packages/api/src/app";
import { loginCookie, resetData, sql } from "./helpers";

const ORG = "https://dev.azure.com/myorg";

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** Longest matching prefix answers; the body is kept raw so uploads survive. */
function mockFetch(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(ORG, "");
      calls.push({ method: init?.method ?? "GET", path, body: init?.body });
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => path.startsWith(k));
      if (!key) throw new Error(`unexpected fetch ${path}`);
      const answer = routes[key];
      if (answer instanceof Error)
        return {
          ok: false,
          status: 400,
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

const client = () =>
  createAdoClient({ baseUrl: ORG, slug: "ado", config: {}, token: "t" });

afterEach(() => vi.unstubAllGlobals());
afterAll(() => sql.end());

describe("creatable types", () => {
  it("drops disabled types and ADO's hidden category, keeps icon and color", async () => {
    mockFetch({
      "/ProjA/_apis/wit/workitemtypes": {
        value: [
          { name: "Bug", color: "CC293D", icon: { id: "icon_insect" } },
          { name: "Task", color: "F2CB1D", icon: { id: "icon_clipboard" } },
          { name: "Code Review Request" },
          { name: "Retired", isDisabled: true },
        ],
      },
      "/ProjA/_apis/wit/workitemtypecategories": {
        value: [
          {
            referenceName: "Microsoft.HiddenCategory",
            workItemTypes: [{ name: "Code Review Request" }],
          },
        ],
      },
    });
    expect(await creatableTypes(client(), "ProjA")).toEqual([
      { name: "Bug", description: null, color: "CC293D", icon: "icon_insect" },
      {
        name: "Task",
        description: null,
        color: "F2CB1D",
        icon: "icon_clipboard",
      },
    ]);
  });

  it("hides nothing when the categories cannot be read", async () => {
    mockFetch({
      "/ProjA/_apis/wit/workitemtypes": { value: [{ name: "Bug" }] },
      "/ProjA/_apis/wit/workitemtypecategories": new Error("403 nope"),
    });
    expect(
      (await creatableTypes(client(), "ProjA")).map((t) => t.name),
    ).toEqual(["Bug"]);
  });
});

describe("paths", () => {
  it("roots team-relative paths at the project", () => {
    expect(fieldPath("ProjA", "\\Iteration 1")).toBe("ProjA\\Iteration 1");
    expect(fieldPath("ProjA", "ProjA\\Sprint 3")).toBe("ProjA\\Sprint 3");
    expect(fieldPath("ProjA", "\\")).toBe("ProjA");
    expect(fieldPath("ProjA", null)).toBeNull();
  });

  it("builds tree paths from names, without the structure segment", () => {
    expect(
      flattenTree({
        name: "ProjA",
        path: "\\ProjA\\Area",
        children: [{ name: "Portal", children: [{ name: "Print" }] }],
      }),
    ).toEqual(["ProjA", "ProjA\\Portal", "ProjA\\Portal\\Print"]);
  });
});

describe("composer form", () => {
  const team = "/ProjA/ProjA%20Team";
  const routes = (settings: unknown) => ({
    "/_apis/projects/ProjA": {
      id: "p",
      name: "ProjA",
      defaultTeam: { id: "t", name: "ProjA Team" },
    },
    "/_apis/projects/ProjA/teams?": {
      value: [{ id: "t", name: "ProjA Team" }],
    },
    "/_apis/connectionData": {
      authenticatedUser: {
        providerDisplayName: "Me Myself",
        properties: { Account: { $value: "me@corp" } },
      },
    },
    "/_apis/projects/p/properties": {
      value: [{ name: "System.ProcessTemplateType", value: "proc-1" }],
    },
    "/ProjA/_apis/wit/workitemtypes?": {
      value: [{ name: "Bug", referenceName: "Custom.Bug" }],
    },
    "/_apis/work/processes/proc-1/workItemTypes/Custom.Bug/layout": {
      systemControls: [
        { id: "System.AssignedTo", label: "Assi&gned To" },
        { id: "System.AreaPath", label: "&Area" },
      ],
      pages: [],
    },
    "/_apis/projects/ProjA/teams/ProjA%20Team/members": {
      value: [
        { identity: { displayName: "Zoe", uniqueName: "zoe@corp" } },
        { identity: { displayName: "Ann", uniqueName: "ann@corp" } },
        {
          identity: {
            displayName: "Devs",
            uniqueName: "devs",
            isContainer: true,
          },
        },
      ],
    },
    "/ProjA/_apis/wit/workitemtypes/Bug/fields": {
      value: [
        { referenceName: "System.Title", name: "Title", alwaysRequired: true },
        {
          referenceName: "Microsoft.VSTS.Common.Priority",
          name: "Priority",
          defaultValue: 2,
          allowedValues: [1, 2, 3, 4],
        },
        {
          referenceName: "Microsoft.VSTS.Common.Severity",
          name: "Severity",
          defaultValue: "3 - Medium",
        },
        { referenceName: "System.AreaPath", name: "Area Path" },
        { referenceName: "System.IterationPath", name: "Iteration Path" },
      ],
    },
    "/_apis/wit/fields": { value: [] },
    [`${team}/_apis/work/teamsettings`]: settings,
    [`${team}/_apis/work/teamsettings/iterations?$timeframe=current`]: {
      value: [{ id: "s3", name: "Sprint 3", path: "ProjA\\Sprint 3" }],
    },
    [`${team}/_apis/work/teamsettings/iterations`]: {
      value: [
        {
          id: "s2",
          name: "Sprint 2",
          path: "ProjA\\Sprint 2",
          attributes: { timeFrame: "past" },
        },
        {
          id: "s3",
          name: "Sprint 3",
          path: "ProjA\\Sprint 3",
          attributes: { timeFrame: "current" },
        },
        {
          id: "s4",
          name: "Sprint 4",
          path: "ProjA\\Sprint 4",
          attributes: { timeFrame: "future" },
        },
      ],
    },
    [`${team}/_apis/work/teamsettings/teamfieldvalues`]: {
      defaultValue: "ProjA\\Portal",
      values: [{ value: "ProjA\\Portal" }],
    },
    "/ProjA/_apis/wit/classificationnodes/Areas": {
      name: "ProjA",
      children: [{ name: "Portal" }, { name: "Backend" }],
    },
    "/ProjA/_apis/wit/classificationnodes/Iterations": {
      name: "ProjA",
      children: [
        { name: "Sprint 2" },
        { name: "Sprint 3" },
        { name: "Sprint 4" },
      ],
    },
    [`${team}/_apis/wit/templates`]: {
      value: [{ id: "tpl", name: "Crash", description: "" }],
    },
  });

  it("layers process, team and configured defaults, highest last", async () => {
    mockFetch(
      routes({
        defaultIterationMacro: "@currentIteration",
        defaultIteration: { path: "\\Sprint 2" },
      }),
    );
    const form = await composerForm(client(), "ProjA", "Bug", {
      configDefaults: { "Microsoft.VSTS.Common.Severity": "2 - High" },
    });
    expect(form.team).toBe("ProjA Team");
    expect(form.prefill["Microsoft.VSTS.Common.Priority"]).toEqual({
      value: 2,
      origin: "process",
    });
    expect(form.prefill["Microsoft.VSTS.Common.Severity"]).toEqual({
      value: "2 - High",
      origin: "config",
    });
    expect(form.prefill["System.AreaPath"]).toEqual({
      value: "ProjA\\Portal",
      origin: "team",
    });
    expect(form.prefill["System.IterationPath"]).toEqual({
      value: "ProjA\\Sprint 3",
      origin: "team",
    });
  });

  it("treats a list of only ADO's <None> placeholder as free text", async () => {
    const r = routes({});
    (
      r["/ProjA/_apis/wit/workitemtypes/Bug/fields"] as { value: unknown[] }
    ).value.push({
      referenceName: "Microsoft.VSTS.Build.FoundIn",
      name: "Found In",
      allowedValues: ["<None>"],
    });
    mockFetch(r);
    const form = await composerForm(client(), "ProjA", "Bug");
    expect(form.widgets["Microsoft.VSTS.Build.FoundIn"]).toEqual({
      kind: "suggest",
      values: [],
    });
  });

  it("uses the team's fixed default iteration when no macro is set", async () => {
    mockFetch(routes({ defaultIteration: { path: "\\Sprint 4" } }));
    const form = await composerForm(client(), "ProjA", "Bug");
    expect(form.prefill["System.IterationPath"]?.value).toBe("ProjA\\Sprint 4");
  });

  it("lists the team's own choices first, then the rest of the tree", async () => {
    mockFetch(routes({}));
    const form = await composerForm(client(), "ProjA", "Bug");
    expect(form.areas.map((a) => a.path)).toEqual([
      "ProjA\\Portal",
      "ProjA",
      "ProjA\\Backend",
    ]);
    expect(form.areas[0].team).toBe(true);
    expect(form.iterations.slice(0, 2)).toEqual([
      { path: "ProjA\\Sprint 3", team: true, current: true },
      { path: "ProjA\\Sprint 4", team: true },
    ]);
    expect(form.me).toEqual({ name: "Me Myself", unique_name: "me@corp" });
    expect(form.people).toEqual([
      { name: "Me Myself", unique_name: "me@corp" },
      { name: "Ann", unique_name: "ann@corp" },
      { name: "Zoe", unique_name: "zoe@corp" },
    ]);
    expect(form.layout?.groups[0]).toEqual({
      label: null,
      fields: ["System.AreaPath", "System.IterationPath"],
    });
    expect(form.templates).toEqual([
      { id: "tpl", name: "Crash", description: null },
    ]);
  });

  it("still draws the form when the team lookups are refused", async () => {
    mockFetch({
      ...routes({}),
      "/_apis/projects/ProjA": new Error("401"),
    });
    const form = await composerForm(client(), "ProjA", "Bug");
    expect(form.team).toBeNull();
    expect(form.fields.length).toBe(5);
    // People come from every team, so they survive the default team's lookup failing.
    expect(form.people.map((p) => p.unique_name)).toContain("me@corp");
    expect(form.templates).toEqual([]);
  });
});

describe("projectLayout", () => {
  const f = (
    reference_name: string,
    extra: Partial<FieldSpec> = {},
  ): FieldSpec => ({
    reference_name,
    name: reference_name.split(".").pop()!,
    required: false,
    ...extra,
  });
  const fields = [
    f("System.AssignedTo", { name: "Assigned To" }),
    f("System.AreaPath", { name: "Area Path" }),
    f("System.Description", { type: "html" }),
    f("Microsoft.VSTS.TCM.ReproSteps", { type: "html" }),
    f("Microsoft.VSTS.TCM.SystemInfo", { type: "html" }),
    f("Microsoft.VSTS.Common.Priority"),
    f("Microsoft.VSTS.Common.Severity"),
    f("Custom.Area", { name: "Area" }),
    f("Custom.Cloud"),
    f("System.CreatedBy", { read_only: true }),
  ];
  // Shaped after a real Scrum-derived Bug: Priority and System Info hidden,
  // Custom.Area relabelled, Cloud drawn by the multivalue extension.
  const layout = {
    systemControls: [
      { id: "System.Title" },
      { id: "System.AssignedTo", label: "Assi&gned To" },
      { id: "System.State" },
      { id: "System.AreaPath", label: "&Area" },
    ],
    pages: [
      {
        pageType: "custom",
        sections: [
          {
            groups: [
              {
                label: "Description",
                controls: [{ id: "System.Description" }],
              },
              {
                label: "Repro Steps",
                controls: [{ id: "Microsoft.VSTS.TCM.ReproSteps" }],
              },
              {
                label: "System Info",
                visible: false,
                controls: [{ id: "Microsoft.VSTS.TCM.SystemInfo" }],
              },
            ],
          },
          {
            groups: [
              {
                label: "Planning",
                controls: [
                  { id: "Microsoft.VSTS.Common.Priority", visible: false },
                  { id: "Microsoft.VSTS.Common.Severity" },
                  { id: "System.CreatedBy" },
                ],
              },
              {
                label: "System Info",
                controls: [
                  {
                    id: "3efcf0af",
                    label: "Clouds",
                    isContribution: true,
                    contribution: {
                      contributionId:
                        "ms-devlabs.vsts-extensions-multivalue-control.multivalue-form-control",
                      inputs: {
                        FieldName: "Custom.Cloud",
                        Values: "DEV;QA;PROD",
                        AllowCustom: true,
                      },
                    },
                  },
                  { id: "Custom.Area", label: "Component" },
                ],
              },
              { label: "Board", isContribution: true, controls: [] },
            ],
          },
        ],
      },
      { pageType: "history", sections: [] },
    ],
  };

  it("keeps what ADO shows, splits prose from the rest, and follows its groups", () => {
    const { layout: l } = projectLayout(layout, fields);
    expect(l.body).toEqual([
      "System.Description",
      "Microsoft.VSTS.TCM.ReproSteps",
    ]);
    expect(l.groups).toEqual([
      { label: null, fields: ["System.AssignedTo", "System.AreaPath"] },
      { label: "Planning", fields: ["Microsoft.VSTS.Common.Severity"] },
      { label: "System Info", fields: ["Custom.Cloud", "Custom.Area"] },
    ]);
  });

  it("takes ADO's labels and reads the multivalue control's options", () => {
    const { labels, widgets } = projectLayout(layout, fields);
    expect(labels).toEqual({
      "System.AreaPath": "Area",
      "Custom.Area": "Component",
      "Custom.Cloud": "Clouds",
    });
    expect(widgets["Custom.Cloud"]).toEqual({
      kind: "multi",
      values: ["DEV", "QA", "PROD"],
      allow_custom: true,
    });
  });
});

describe("pasted images", () => {
  it("finds the keys fields refer to and rewrites them to uploads", () => {
    const fields = {
      "System.Description": '<p>see <img src="attachment:a1"></p>',
      "Microsoft.VSTS.TCM.ReproSteps": '<img src="attachment:b2">',
      "Microsoft.VSTS.Common.Priority": 2,
    };
    expect([...referencedKeys(fields)].sort()).toEqual(["a1", "b2"]);
    expect(
      rewriteAttachments(fields, new Map([["a1", "https://x/1"]])),
    ).toEqual({
      ...fields,
      "System.Description": '<p>see <img src="https://x/1"></p>',
    });
  });
});

describe("explainAdoError", () => {
  it("pulls ADO's message and the fields it names", () => {
    const raw = `Azure DevOps POST /ProjA/_apis/wit/workitems/$Bug -> 400 {"message":"TF401320: Rule Error for field Severity. Error code: Required, InvalidEmpty."}`;
    expect(explainAdoError(raw)).toEqual({
      ok: false,
      message:
        "TF401320: Rule Error for field Severity. Error code: Required, InvalidEmpty.",
      fields: ["Severity"],
    });
  });

  it("names quoted reference names too", () => {
    const raw = `Azure DevOps POST x -> 400 {"message":"TF401347: Invalid tree name given for work item -1, field 'System.AreaPath'."}`;
    expect(explainAdoError(raw).fields).toEqual(["System.AreaPath"]);
  });
});

describe("/api/compose", () => {
  const app = createApp({ passwordAuth: true });
  let memberCookie: string;
  let outsiderCookie: string;
  let adminCookie: string;
  let projectId: string;

  const req = (cookie: string, path: string, init: RequestInit = {}) =>
    app.request(`/api/compose${path}`, {
      ...init,
      headers: { cookie, ...(init.headers ?? {}) },
    });

  beforeAll(async () => {
    process.env.AZURE_DEVOPS_TOKEN_ADO_AZ = "test-pat";
    await resetData();
    clearPermissionCache();
    await addSourceConnection({
      sourceType: "azure-devops",
      slug: "ado-az",
      baseUrl: ORG,
    });
    await addTeam("elsewhere", "Elsewhere");
    projectId = (
      await addSourceProject({
        sourceSlug: "ado-az",
        externalKey: "ProjA",
        teamSlug: "test-team",
      })
    ).id;
    await addSourceProject({
      sourceSlug: "ado-az",
      externalKey: "ProjB",
      teamSlug: "elsewhere",
    });
    await createUser({
      email: "root@example.com",
      role: "admin",
      password: "root-password",
    });
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
    adminCookie = await loginCookie(app, "root@example.com", "root-password");
    memberCookie = await loginCookie(app, "dev@example.com", "dev-password");
    outsiderCookie = await loginCookie(app, "out@example.com", "out-password");
  });

  afterAll(async () => {
    delete process.env.AZURE_DEVOPS_TOKEN_ADO_AZ;
    await sql`delete from source_connections where slug = 'ado-az'`;
  });

  const keys = async (cookie: string) =>
    (
      (await (await req(cookie, "/projects?source_type=azure-devops")).json()) as {
        external_key: string;
      }[]
    )
      .map((p) => p.external_key)
      .sort();

  it("lists only the projects of the caller's teams; admins see all", async () => {
    expect(await keys(memberCookie)).toEqual(["ProjA"]);
    expect(await keys(outsiderCookie)).toEqual(["ProjB"]);
    expect(await keys(adminCookie)).toEqual(["ProjA", "ProjB"]);
  });

  it("refuses another team's project before calling ADO", async () => {
    const calls = mockFetch({});
    const res = await req(outsiderCookie, `/projects/${projectId}/types`);
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("creates with pasted images uploaded and linked in", async () => {
    const calls = mockFetch({
      "/ProjA/_apis/wit/attachments": {
        id: "att",
        url: `${ORG}/_apis/wit/attachments/att?fileName=shot.png`,
      },
      "/ProjA/_apis/wit/workitems/$Bug": {
        id: 77,
        _links: { html: { href: `${ORG}/ProjA/_workitems/edit/77` } },
      },
    });
    const form = new FormData();
    form.set(
      "draft",
      JSON.stringify({
        type: "Bug",
        title: "Label printer jams",
        fields: {
          "Microsoft.VSTS.TCM.ReproSteps":
            '<p>1. print</p><img src="attachment:k1">',
        },
      }),
    );
    form.set("image:k1", new File([new Uint8Array([1, 2, 3])], "shot.png"));
    form.set("image:unused", new File([new Uint8Array([9])], "old.png"));
    const res = await req(memberCookie, `/projects/${projectId}/items`, {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: 77,
      url: `${ORG}/ProjA/_workitems/edit/77`,
      title: "Label printer jams",
      type: "Bug",
      project: "ProjA",
    });
    const uploads = calls.filter((c) => c.path.includes("/attachments"));
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toContain("fileName=shot.png");
    const create = calls.find((c) => c.path.includes("/workitems/$Bug"))!;
    const patch = JSON.parse(String(create.body)) as {
      path: string;
      value: unknown;
    }[];
    expect(
      patch.find((p) => p.path === "/fields/Microsoft.VSTS.TCM.ReproSteps")
        ?.value,
    ).toBe(
      `<p>1. print</p><img src="${ORG}/_apis/wit/attachments/att?fileName=shot.png">`,
    );
    expect(patch.find((p) => p.path === "/fields/System.Title")?.value).toBe(
      "Label printer jams",
    );
  });

  it("validates without saving and reports the fields ADO names", async () => {
    const calls = mockFetch({
      "/ProjA/_apis/wit/workitems/$Bug": new Error(
        `{"message":"TF401320: Rule Error for field Severity. Error code: Required, InvalidEmpty."}`,
      ),
    });
    const res = await req(memberCookie, `/projects/${projectId}/validate`, {
      method: "POST",
      body: JSON.stringify({ type: "Bug", title: "x", fields: {} }),
      headers: { "Content-Type": "application/json" },
    });
    expect(await res.json()).toMatchObject({ ok: false, fields: ["Severity"] });
    expect(calls[0].path).toContain("validateOnly=true");
  });
});

describe("createWorkItem", () => {
  it("skips the upload for an image no field refers to any more", async () => {
    const calls = mockFetch({
      "/ProjA/_apis/wit/workitems/$Task": { id: 5 },
    });
    await createWorkItem(
      client(),
      {
        project: "ProjA",
        type: "Task",
        title: "t",
        fields: { "System.Description": "<p>no images</p>" },
        images: [{ key: "gone", name: "g.png", bytes: new Uint8Array([1]) }],
      },
      { sourceSlug: "ado", userId: null },
    );
    expect(
      calls.map((c) => c.path).some((p) => p.includes("attachments")),
    ).toBe(false);
  });
});
