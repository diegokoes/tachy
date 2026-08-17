import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createUser,
  registerSource,
  resolveSource,
  setCredential,
  deleteSourceConnection,
  type SourceFactory,
} from "@tachy/core";
import { createApp } from "../packages/api/src/app";
import { enableVault, json, loginCookie, resetData, sql } from "./helpers";

afterAll(() => sql.end());

/** Records what resolveSource handed the adapter, and answers /test. */
let seen: { token?: string; baseUrl: string } | null = null;
let verifyFails = false;
let groupsForbidden = false;

const fakeFactory: SourceFactory = (cfg) => {
  seen = { token: cfg.token, baseUrl: cfg.baseUrl };
  return {
    type: "fake",
    capabilities: { postNote: false, incrementalSync: false },
    async fetchItem() {
      throw new Error("not used");
    },
    async listItems() {
      return { items: [] };
    },
    async verify() {
      if (verifyFails) throw new Error("401 bad token");
      if (groupsForbidden)
        return {
          identity: "svc@example.com",
          groups: [],
          groupsNote: "GET /groups -> 403 access_denied",
        };
      return {
        identity: "svc@example.com",
        groups: [{ key: "Proj A", name: "Proj A" }],
      };
    },
  };
};
registerSource("fake", fakeFactory);

const app = createApp({ passwordAuth: true });

async function adminCookie(): Promise<string> {
  await createUser({
    email: "root@example.com",
    password: "a-long-password",
    role: "admin",
  });
  return loginCookie(app, "root@example.com", "a-long-password");
}

beforeEach(async () => {
  await resetData();
  await sql`delete from source_connections where slug like 'ui-%'`;
  await sql`truncate credentials cascade`;
  enableVault();
  seen = null;
  verifyFails = false;
  groupsForbidden = false;
});

afterEach(() => {
  delete process.env.FAKE_TOKEN_UI_CONN;
});

describe("creating a connection from the admin UI", () => {
  it("stores the API token in the vault and reports its scope, never the value", async () => {
    const cookie = await adminCookie();
    const post = await app.request("/api/source-connections", {
      ...json({
        sourceType: "fake",
        slug: "ui-conn",
        baseUrl: "https://acme.example.com",
        config: { projects: ["Proj A"] },
        token: "super-secret-pat",
      }),
      headers: { "Content-Type": "application/json", cookie },
    });
    expect(post.status).toBe(200);
    expect(await post.text()).not.toContain("super-secret-pat");

    const list = await app.request("/api/source-connections", {
      headers: { cookie },
    });
    const body = (await list.json()) as {
      slug: string;
      token_source: string | null;
      config: Record<string, unknown>;
    }[];
    const row = body.find((r) => r.slug === "ui-conn")!;
    expect(row.token_source).toBe("global");
    expect(row.config).toEqual({ projects: ["Proj A"] });

    const stored = await sql`select name from credentials`;
    expect(stored.map((r) => r.name)).toEqual(["fake_token:ui-conn"]);
  });

  it("rejects slugs the credential vault and env vars cannot express", async () => {
    const cookie = await adminCookie();
    for (const slug of ["ui_conn", "UI-conn", "ui.conn", "-ui"]) {
      const res = await app.request("/api/source-connections", {
        ...json({ sourceType: "fake", slug, baseUrl: "https://x.example.com" }),
        headers: { "Content-Type": "application/json", cookie },
      });
      expect(res.status, slug).toBe(400);
    }
  });

  it("re-posting the same slug edits in place and keeps the existing token", async () => {
    const cookie = await adminCookie();
    const headers = { "Content-Type": "application/json", cookie };
    await app.request("/api/source-connections", {
      ...json({
        sourceType: "fake",
        slug: "ui-conn",
        baseUrl: "https://one.example.com",
        token: "keep-me",
      }),
      headers,
    });
    await app.request("/api/source-connections", {
      ...json({
        sourceType: "fake",
        slug: "ui-conn",
        baseUrl: "https://two.example.com",
        config: { projects: ["B"] },
      }),
      headers,
    });

    const [row] =
      await sql`select base_url, config from source_connections where slug = 'ui-conn'`;
    expect(row.base_url).toBe("https://two.example.com");
    expect(row.config).toEqual({ projects: ["B"] });
    await resolveSource("ui-conn");
    expect(seen?.token).toBe("keep-me");
  });
});

describe("token resolution reaches the adapter", () => {
  it("passes the caller's vault token, most-specific scope first", async () => {
    const admin = await createUser({
      email: "root@example.com",
      password: "a-long-password",
      role: "admin",
    });
    const alice = await createUser({
      email: "alice@example.com",
      password: "a-long-password",
    });
    await sql`insert into source_connections (source_type, slug, base_url)
              values ('fake', 'ui-conn', 'https://acme.example.com')`;

    await setCredential(
      admin.id,
      "global",
      undefined,
      "fake_token:ui-conn",
      "global-token",
    );
    await resolveSource("ui-conn", { userId: alice.id });
    expect(seen?.token).toBe("global-token");

    await setCredential(
      alice.id,
      "user",
      alice.id,
      "fake_token:ui-conn",
      "alices-token",
    );
    await resolveSource("ui-conn", { userId: alice.id });
    expect(seen?.token).toBe("alices-token");
  });

  it("falls back to the env var when no vault row exists", async () => {
    await sql`insert into source_connections (source_type, slug, base_url)
              values ('fake', 'ui-conn', 'https://acme.example.com')`;
    process.env.FAKE_TOKEN_UI_CONN = "env-token";
    await resolveSource("ui-conn");
    expect(seen?.token).toBe("env-token");
  });
});

describe("the test button", () => {
  it("reports the identity and the groups a product map can use", async () => {
    const cookie = await adminCookie();
    await app.request("/api/source-connections", {
      ...json({
        sourceType: "fake",
        slug: "ui-conn",
        baseUrl: "https://acme.example.com",
        token: "t",
      }),
      headers: { "Content-Type": "application/json", cookie },
    });

    const res = await app.request("/api/source-connections/ui-conn/test", {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      identity: "svc@example.com",
      groups: [{ key: "Proj A" }],
    });
  });

  it("still passes when the token may not list groups", async () => {
    const cookie = await adminCookie();
    await app.request("/api/source-connections", {
      ...json({
        sourceType: "fake",
        slug: "ui-conn",
        baseUrl: "https://acme.example.com",
        token: "t",
      }),
      headers: { "Content-Type": "application/json", cookie },
    });
    groupsForbidden = true;

    const res = await app.request("/api/source-connections/ui-conn/test", {
      method: "POST",
      headers: { cookie },
    });
    const body = (await res.json()) as {
      ok: boolean;
      identity: string;
      groups: unknown[];
      groupsNote: string;
    };
    expect(body.ok).toBe(true);
    expect(body.identity).toBe("svc@example.com");
    expect(body.groups).toEqual([]);
    expect(body.groupsNote).toContain("403");
  });

  it("returns the remote error instead of failing the request", async () => {
    const cookie = await adminCookie();
    await app.request("/api/source-connections", {
      ...json({
        sourceType: "fake",
        slug: "ui-conn",
        baseUrl: "https://acme.example.com",
        token: "t",
      }),
      headers: { "Content-Type": "application/json", cookie },
    });
    verifyFails = true;

    const res = await app.request("/api/source-connections/ui-conn/test", {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("401 bad token");
  });
});

describe("deleting a connection", () => {
  it("refuses while work items would cascade, and takes its token when it goes", async () => {
    const admin = await createUser({
      email: "root@example.com",
      password: "a-long-password",
      role: "admin",
    });
    const [conn] = await sql`
      insert into source_connections (source_type, slug, base_url)
      values ('fake', 'ui-conn', 'https://acme.example.com') returning id
    `;
    await setCredential(
      admin.id,
      "global",
      undefined,
      "fake_token:ui-conn",
      "t",
    );
    await sql`
      insert into work_items (source_connection_id, external_id, kind, title, raw)
      values (${conn.id}, '1', 'ticket', 'x', '{}'::jsonb)
    `;

    await expect(deleteSourceConnection("ui-conn")).rejects.toThrow(
      /still has 1 ingested work item/,
    );

    await sql`delete from work_items where source_connection_id = ${conn.id}`;
    expect(await deleteSourceConnection("ui-conn")).toEqual({
      deleted: true,
      slug: "ui-conn",
    });
    expect(await sql`select 1 from credentials`).toHaveLength(0);
  });
});

describe("registering projects on a connection", () => {
  it("binds a project to the connection and takes it along when it is deleted", async () => {
    const cookie = await adminCookie();
    const headers = { "Content-Type": "application/json", cookie };
    await app.request("/api/source-connections", {
      ...json({
        sourceType: "fake",
        slug: "ui-conn",
        baseUrl: "https://acme.example.com",
        token: "pat",
      }),
      headers,
    });

    // The connection test is what surfaces the keys worth registering.
    const probe = await app.request("/api/source-connections/ui-conn/test", {
      method: "POST",
      headers,
    });
    const groups = ((await probe.json()) as { groups: { key: string }[] })
      .groups;
    expect(groups.map((g) => g.key)).toContain("Proj A");

    const created = await app.request("/api/source-projects", {
      ...json({
        source_slug: "ui-conn",
        external_key: groups[0].key,
        role: "knowledge",
        product_slug: "tpd",
      }),
      headers,
    });
    expect(created.status).toBe(200);

    const list = (await (
      await app.request("/api/source-projects?source=ui-conn", {
        headers: { cookie },
      })
    ).json()) as { external_key: string; role: string; team_slug: string }[];
    expect(list).toEqual([
      expect.objectContaining({
        external_key: "Proj A",
        role: "knowledge",
        team_slug: "test-team",
      }),
    ]);

    await deleteSourceConnection("ui-conn");
    expect(
      await sql`select 1 from source_projects where external_key = 'Proj A'`,
    ).toHaveLength(0);
  });
});
