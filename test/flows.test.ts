import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  addSourceConnection,
  addSourceProject,
  addTeam,
  applyFormConfig,
  clearPermissionCache,
  createUser,
  getComposeConfig,
  offeredTypes,
  setComposeConfig,
  setTeamMember,
  type ComposerForm,
} from "@tachy/core";
import { createApp } from "../packages/api/src/app";
import { reviewPrompt } from "../packages/api/src/ticket-review";
import { loginCookie, resetData, sql } from "./helpers";

const ORG = "https://dev.azure.com/flowsorg";

const form = (over: Partial<ComposerForm> = {}): ComposerForm => ({
  project: "P",
  type: "Bug",
  team: null,
  fields: [
    {
      reference_name: "System.AssignedTo",
      name: "Assigned To",
      required: false,
      is_identity: true,
    },
    {
      reference_name: "Custom.Reporter",
      name: "Reporter",
      required: true,
      is_identity: true,
    },
    { reference_name: "Custom.Cloud", name: "Cloud", required: true },
    {
      reference_name: "Microsoft.VSTS.Common.Priority",
      name: "Priority",
      required: false,
    },
  ],
  prefill: {
    "Microsoft.VSTS.Common.Priority": { value: 2, origin: "process" },
  },
  areas: [],
  iterations: [],
  people: [],
  me: { name: "Me", unique_name: "me@corp" },
  templates: [],
  layout: null,
  labels: {},
  widgets: {},
  ...over,
});

describe("applyFormConfig", () => {
  it("turns the team's defaults into prefills, @me into the caller", () => {
    const f = applyFormConfig(form(), {
      fields: {
        "System.AssignedTo": { default: { value: "luca@corp" } },
        "Custom.Reporter": { default: { macro: "@me" } },
        "Custom.Cloud": { default: { value: "PROD" }, show: "form" },
        "Microsoft.VSTS.Common.Priority": { show: "hidden" },
        "Custom.Gone": { default: { value: "x" }, show: "fold" },
      },
      order: ["Custom.Cloud", "Custom.Gone", "Custom.Reporter"],
    });
    expect(f.prefill).toEqual({
      "Microsoft.VSTS.Common.Priority": { value: 2, origin: "process" },
      "System.AssignedTo": { value: "luca@corp", origin: "admin" },
      "Custom.Reporter": { value: "me@corp", origin: "admin" },
      "Custom.Cloud": { value: "PROD", origin: "admin" },
    });
    expect(f.display).toEqual({
      show: {
        "Custom.Cloud": "form",
        "Microsoft.VSTS.Common.Priority": "hidden",
      },
      order: ["Custom.Cloud", "Custom.Reporter"],
    });
  });

  it("leaves @me empty when the source cannot say who the caller is", () => {
    const f = applyFormConfig(form({ me: null }), {
      fields: { "Custom.Reporter": { default: { macro: "@me" } } },
    });
    expect(f.prefill["Custom.Reporter"]).toBeUndefined();
  });

  it("changes nothing without a config for the type", () => {
    const f = form();
    expect(applyFormConfig(f, undefined)).toBe(f);
  });
});

describe("offeredTypes", () => {
  const all = ["Bug", "Epic", "Task", "User Story"].map((name) => ({
    name,
    description: null,
    color: null,
    icon: null,
  }));

  it("offers the team's pick in its order, skipping types that no longer exist", () => {
    expect(
      offeredTypes(all, { types: ["User Story", "Retired", "Bug"] }).map(
        (t) => t.name,
      ),
    ).toEqual(["User Story", "Bug"]);
  });

  it("offers everything when the team chose nothing", () => {
    expect(offeredTypes(all, {})).toBe(all);
    expect(offeredTypes(all, { types: [] })).toBe(all);
  });
});

describe("flows config", () => {
  const app = createApp({ passwordAuth: true });
  let projectId: string;
  let leadCookie: string;
  let devCookie: string;

  const req = (cookie: string, path: string, init: RequestInit = {}) =>
    app.request(`/api/compose${path}`, {
      ...init,
      headers: {
        cookie,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

  beforeAll(async () => {
    process.env.AZURE_DEVOPS_TOKEN_FLOWS_ADO = "test-pat";
    await resetData();
    clearPermissionCache();
    await addSourceConnection({
      sourceType: "azure-devops",
      slug: "flows-ado",
      baseUrl: ORG,
    });
    projectId = (
      await addSourceProject({
        sourceSlug: "flows-ado",
        externalKey: "ProjF",
        teamSlug: "test-team",
        config: { team: "Keep me" },
      })
    ).id;
    await addTeam("elsewhere", "Elsewhere");
    await createUser({
      email: "root@example.com",
      role: "admin",
      password: "root-password",
    });
    await createUser({
      email: "lead@example.com",
      role: "member",
      password: "lead-password",
    });
    await createUser({
      email: "dev@example.com",
      role: "member",
      password: "dev-password",
    });
    await setTeamMember("test-team", "lead@example.com", "admin");
    await setTeamMember("test-team", "dev@example.com", "member");
    leadCookie = await loginCookie(app, "lead@example.com", "lead-password");
    devCookie = await loginCookie(app, "dev@example.com", "dev-password");
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    delete process.env.AZURE_DEVOPS_TOKEN_FLOWS_ADO;
    await sql`delete from source_connections where slug = 'flows-ado'`;
    await sql.end();
  });

  it("stores the config beside the project's other settings", async () => {
    await setComposeConfig(projectId, { types: ["Bug"] });
    expect(await getComposeConfig(projectId)).toEqual({ types: ["Bug"] });
    const [row] =
      await sql`select config from source_projects where id = ${projectId}`;
    expect(row.config.team).toBe("Keep me");
  });

  it("lets the project's team admins edit it, and not its other members", async () => {
    const body = JSON.stringify({
      types: ["Bug", "Task"],
      forms: {
        Bug: {
          fields: {
            "Custom.Reporter": { show: "form", default: { macro: "@me" } },
          },
          guidance: "Always ask for the MES version.",
        },
      },
    });
    const denied = await req(devCookie, `/projects/${projectId}/config`, {
      method: "PUT",
      body,
    });
    expect(denied.status).toBe(403);
    const ok = await req(leadCookie, `/projects/${projectId}/config`, {
      method: "PUT",
      body,
    });
    expect(ok.status).toBe(200);
    expect((await getComposeConfig(projectId)).forms?.Bug.guidance).toBe(
      "Always ask for the MES version.",
    );
  });

  it("refuses a config it would not know how to apply", async () => {
    const res = await req(leadCookie, `/projects/${projectId}/config`, {
      method: "PUT",
      body: JSON.stringify({
        forms: { Bug: { fields: { X: { show: "sometimes" } } } },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("serves the form with the team's defaults, and raw without them", async () => {
    await setComposeConfig(projectId, {
      forms: {
        Bug: { fields: { "Custom.Cloud": { default: { value: "PROD" } } } },
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = url.replace(ORG, "");
        const answer = path.startsWith(
          "/ProjF/_apis/wit/workitemtypes/Bug/fields",
        )
          ? {
              value: [
                {
                  referenceName: "Custom.Cloud",
                  name: "Cloud",
                  alwaysRequired: true,
                },
              ],
            }
          : path.startsWith("/_apis/wit/fields")
            ? { value: [] }
            : null;
        return answer
          ? ({
              ok: true,
              status: 200,
              text: async () => JSON.stringify(answer),
            } as Response)
          : ({ ok: false, status: 404, text: async () => "{}" } as Response);
      }),
    );
    const applied = await (
      await req(devCookie, `/projects/${projectId}/form?type=Bug`)
    ).json();
    expect(applied.prefill["Custom.Cloud"]).toEqual({
      value: "PROD",
      origin: "admin",
    });
    const raw = await (
      await req(devCookie, `/projects/${projectId}/form?type=Bug&raw=1`)
    ).json();
    expect(raw.prefill["Custom.Cloud"]).toBeUndefined();
  });

  it("puts the team's guidance into the review", () => {
    const p = reviewPrompt({
      type: "Bug",
      title: "t",
      fields: [],
      images: 0,
      context: [],
      guidance: "Always ask for the MES version.",
    });
    expect(p).toContain(
      "The team that owns this project also asks: Always ask for the MES version.",
    );
  });
});
