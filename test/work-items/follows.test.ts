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
import {
  addSourceConnection,
  addSourceProject,
  registerSource,
} from "@tachy/core/sources";
import {
  clearPermissionCache,
  createUser,
  setTeamMember,
} from "@tachy/core/access";
import { setCredential } from "@tachy/core/config";
import { describeJobKinds } from "@tachy/core/jobs";
import {
  checkFollows,
  followWorkItem,
  ingestWorkItem,
  listFollows,
  unfollowWorkItem,
} from "@tachy/core/work-items";
import { changeLines, clearTypeLists } from "@tachy/source-azure-devops";
import type {
  NotificationRow,
  WorkItemPage,
  WorkItemView,
} from "@tachy/contract";
import { createApp } from "../../packages/api/src/app";
import { loginCookie } from "../http";
import { enableVault } from "../vault";
import { resetData, sql } from "../database";

const ORG = "https://dev.azure.com/followorg";

/** Private notes the fake helpdesk took, by ticket. */
const helpdeskNotes: { id: string; body: string; private?: boolean }[] = [];

registerSource("fake-helpdesk", () => ({
  type: "fake-helpdesk",
  capabilities: { postNote: true, incrementalSync: false },
  async fetchItem() {
    throw new Error("not used");
  },
  async listItems() {
    return { items: [] };
  },
  async postNote(id: string, body: string, opts?: { private?: boolean }) {
    helpdeskNotes.push({ id, body, private: opts?.private });
  },
}));
const READER = "dev@example.com";

/** Longest matching prefix answers; the answer may depend on the call. */
function mockAdo(
  routes: Record<string, unknown | ((path: string) => unknown)>,
) {
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
      const route = routes[key];
      const answer = typeof route === "function" ? route(path) : route;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(answer),
      } as Response;
    }),
  );
  return paths;
}

const update = (
  rev: number,
  by: string,
  fields: Record<string, { oldValue?: unknown; newValue?: unknown }>,
) => ({
  id: rev,
  rev,
  revisedBy: { displayName: by.split("@")[0], uniqueName: by },
  fields: {
    "System.ChangedDate": { newValue: `2026-10-1${rev}T08:00:00Z` },
    ...fields,
  },
});

describe("changeLines", () => {
  it("says comments, the state's whole move, the assignee and other fields", () => {
    expect(
      changeLines([
        update(2, "ana@x.io", {
          "System.State": { oldValue: "New", newValue: "Active" },
          "System.History": { newValue: "<p>Looking</p>" },
        }),
        update(3, "ben@x.io", {
          "System.State": { oldValue: "Active", newValue: "Resolved" },
          "System.AssignedTo": { newValue: { displayName: "Ben" } },
          "Microsoft.VSTS.Common.Severity": { oldValue: "3", newValue: "2" },
          "System.History": { newValue: "<p>Fixed</p>" },
        }),
      ]),
    ).toEqual([
      "state New → Resolved",
      "2 new comments",
      "assigned to Ben",
      "also changed: Severity",
    ]);
  });
});

describe("following items", () => {
  const app = createApp({ passwordAuth: true });
  let readerId: string;
  let otherId: string;
  let connectionId: string;
  let projectId: string;
  let cookie: string;

  const notes = (userId: string) =>
    sql<NotificationRow[]>`
      select id, kind, title, body_text, ref, seen_at, read_at, created_at
      from notifications where user_id = ${userId} and kind = 'work_item_changed'
    `;

  beforeAll(async () => {
    enableVault();
    process.env.AZURE_DEVOPS_TOKEN_ADO_FOLLOW = "shared-pat";
    await resetData();
    clearPermissionCache();
    connectionId = (
      await addSourceConnection({
        sourceType: "azure-devops",
        slug: "ado-follow",
        baseUrl: ORG,
      })
    ).id;
    projectId = (
      await addSourceProject({
        sourceSlug: "ado-follow",
        externalKey: "ProjA",
        teamSlug: "test-team",
      })
    ).id;
    readerId = (
      await createUser({
        email: READER,
        role: "member",
        password: "dev-password",
      })
    ).id;
    otherId = (
      await createUser({
        email: "no-token@example.com",
        role: "member",
        password: "other-password",
      })
    ).id;
    await setTeamMember("test-team", READER, "member");
    await setCredential(
      readerId,
      "user",
      readerId,
      "azure-devops_token:ado-follow",
      "dev-pat",
    );
    cookie = await loginCookie(app, READER, "dev-password");
  });

  beforeEach(async () => {
    await sql`delete from work_item_follows`;
    await sql`delete from notifications`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearTypeLists();
  });

  afterAll(async () => {
    delete process.env.AZURE_DEVOPS_TOKEN_ADO_FOLLOW;
    await sql`delete from source_connections where slug = 'ado-follow'`;
    await sql.end();
  });

  const ado = (rev: number, updates: unknown[]) =>
    mockAdo({
      "/_apis/wit/workitems?": {
        value: [
          {
            id: 42,
            rev,
            fields: {
              "System.Title": "Print preview is blank",
              "System.TeamProject": "ProjA",
            },
          },
        ],
      },
      "/_apis/connectionData": {
        authenticatedUser: { properties: { Account: { $value: READER } } },
      },
      "/_apis/wit/workItems/42/updates": { value: updates },
    });

  it("reads the revision first, then notes what others changed, once per item", async () => {
    await followWorkItem({
      userId: readerId,
      connectionId,
      externalId: "42",
      sourceProjectId: projectId,
    });
    ado(3, []);
    expect(await checkFollows()).toMatchObject({ checked: 1, changed: 0 });
    expect(await notes(readerId)).toEqual([]);

    ado(4, [
      update(4, "ana@x.io", {
        "System.State": { oldValue: "New", newValue: "Active" },
      }),
    ]);
    expect(await checkFollows()).toMatchObject({ changed: 1 });
    ado(5, [
      update(4, "ana@x.io", {
        "System.State": { oldValue: "New", newValue: "Active" },
      }),
      update(5, "ana@x.io", { "System.History": { newValue: "<p>Seen</p>" } }),
    ]);
    await checkFollows();
    const [note, ...more] = await notes(readerId);
    expect(more).toEqual([]);
    expect(note.title).toBe("#42 Print preview is blank");
    expect(note.body_text).toBe("1 new comment\nstate New → Active");
    expect(note.ref).toMatchObject({
      external_id: "42",
      source_project_id: projectId,
      connection: "ado-follow",
    });
  });

  it("writes a change back to the tickets the follow notes to", async () => {
    await setCredential(
      readerId,
      "user",
      readerId,
      "fake-helpdesk_token:fd-notes",
      "agent-key",
    );
    const keyed = await addSourceConnection({
      sourceType: "fake-helpdesk",
      slug: "fd-notes",
      baseUrl: "https://example.invalid",
    });
    const keyless = await addSourceConnection({
      sourceType: "fake-helpdesk",
      slug: "fd-keyless",
      baseUrl: "https://example.invalid",
    });
    const ticket = { kind: "ticket" as const, raw: {}, messages: [] };
    const noted = await ingestWorkItem(keyed.id, {
      ...ticket,
      externalId: "7",
    });
    const unkeyed = await ingestWorkItem(keyless.id, {
      ...ticket,
      externalId: "8",
    });
    helpdeskNotes.length = 0;
    for (const noteOnItemId of [noted.id, unkeyed.id])
      await followWorkItem({
        userId: readerId,
        connectionId,
        externalId: "42",
        seenRev: 3,
        noteOnItemId,
      });

    ado(4, [
      update(4, "ana@x.io", {
        "System.State": { oldValue: "New", newValue: "Active" },
      }),
    ]);
    expect(await checkFollows()).toMatchObject({
      changed: 1,
      notes_posted: 1,
      notes_skipped: 1,
    });
    expect(helpdeskNotes).toEqual([
      {
        id: "7",
        private: true,
        body: expect.stringContaining(
          "#42 Print preview is blank changed:\n- state New → Active",
        ),
      },
    ]);
  });

  it("leaves out the follower's own changes", async () => {
    await followWorkItem({
      userId: readerId,
      connectionId,
      externalId: "42",
      seenRev: 3,
    });
    ado(4, [
      update(4, READER, {
        "System.State": { oldValue: "New", newValue: "Active" },
      }),
    ]);
    expect(await checkFollows()).toMatchObject({ checked: 1, changed: 0 });
    expect((await listFollows(readerId))[0].seen_rev).toBe(4);
  });

  it("skips a follower with no token of their own, though the connection has one", async () => {
    await followWorkItem({
      userId: otherId,
      connectionId,
      externalId: "42",
      seenRev: 3,
    });
    const paths = ado(9, []);
    expect(await checkFollows()).toMatchObject({ checked: 0, skipped: 1 });
    expect(paths).toEqual([]);
  });

  it("follows from the current revision and unfollows over HTTP", async () => {
    ado(7, []);
    const path = `/api/work-items/projects/${projectId}/items/42/follow`;
    const followed = await app.request(path, {
      method: "PUT",
      headers: { cookie },
    });
    expect(await followed.json()).toEqual({ following: true });
    expect(await listFollows(readerId)).toMatchObject([
      { external_id: "42", seen_rev: 7, source_project_id: projectId },
    ]);
    const ids = await app.request(
      `/api/work-items/projects/${projectId}/follows`,
      {
        headers: { cookie },
      },
    );
    expect(await ids.json()).toEqual(["42"]);
    await app.request(path, { method: "DELETE", headers: { cookie } });
    expect(await listFollows(readerId)).toEqual([]);
  });

  it("lists nothing followed without asking the source", async () => {
    const paths = mockAdo({});
    const response = await app.request(
      `/api/work-items/projects/${projectId}/items?scope=followed`,
      { headers: { cookie } },
    );
    expect((await response.json()) as WorkItemPage).toEqual({
      items: [],
      total: 0,
      capped: false,
    });
    expect(paths).toEqual([]);
  });

  it("says an item is followed when read, and marks its notes read", async () => {
    await followWorkItem({
      userId: readerId,
      connectionId,
      externalId: "42",
      seenRev: 3,
    });
    ado(4, [
      update(4, "ana@x.io", {
        "System.State": { oldValue: "New", newValue: "Active" },
      }),
    ]);
    await checkFollows();
    mockAdo({
      "/_apis/wit/workitems/42?": {
        id: 42,
        rev: 4,
        fields: {
          "System.Title": "Print preview is blank",
          "System.WorkItemType": "Bug",
          "System.TeamProject": "ProjA",
        },
        relations: [],
      },
      "/ProjA/_apis/wit/workItems/42/comments": { comments: [] },
      "/_apis/wit/workItems/42/updates": { value: [] },
      "/ProjA/_apis/wit/workitemtypes": { value: [] },
      "/_apis/wit/fields": { value: [] },
      "/_apis/projects/ProjA": {},
    });
    const response = await app.request(
      `/api/work-items/projects/${projectId}/items/42`,
      {
        headers: { cookie },
      },
    );
    expect(((await response.json()) as WorkItemView).following).toBe(true);
    const [note] = await notes(readerId);
    expect(note.read_at).not.toBeNull();
  });

  it("unfollows only the item named", async () => {
    await followWorkItem({ userId: readerId, connectionId, externalId: "42" });
    await followWorkItem({ userId: readerId, connectionId, externalId: "43" });
    await unfollowWorkItem(readerId, connectionId, "42");
    expect((await listFollows(readerId)).map((f) => f.external_id)).toEqual([
      "43",
    ]);
  });

  it("checks followed items every ten minutes by default", () => {
    expect(
      describeJobKinds().find((kind) => kind.kind === "work_items.follows"),
    ).toMatchObject({ default_schedule: "*/10 * * * *" });
  });
});
