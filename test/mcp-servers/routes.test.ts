import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createUser } from "@tachy/core/access";
import { closeConnections } from "@tachy/core/mcp-servers";
import { createApp } from "../../packages/api/src/app";
import { json, loginCookie } from "../http";
import { resetData, sql } from "../database";
import { disableVault, enableVault } from "../vault";
import {
  RATE_LIMIT_CODE,
  TOKENS,
  startFakeRemote,
  type FakeRemote,
} from "./fake-server";

const app = createApp({ passwordAuth: true });
let remote: FakeRemote;
let adminCookie = "";
let memberCookie = "";

beforeAll(async () => {
  remote = await startFakeRemote();
});

afterAll(async () => {
  await closeConnections();
  await remote.close();
  await sql.end();
});

function as(cookie: string) {
  return (path: string, method = "GET", body?: unknown) =>
    app.request(path, {
      ...(body === undefined ? {} : json(body)),
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        Cookie: cookie,
      },
    });
}

const server = (credentialMode: "personal" | "shared" = "shared") => ({
  slug: "hub",
  name: "Hub",
  transport: "http",
  config: { url: remote.url, headers: { Authorization: "Bearer {{token}}" } },
  credentialMode,
  toolPrefix: "hub",
  rateWindows: [{ seconds: 60, limit: 15 }],
  rateLimitCodes: [RATE_LIMIT_CODE],
});

beforeEach(async () => {
  await resetData();
  enableVault();
  await createUser({
    email: "admin@example.com",
    password: "a-long-password",
    role: "admin",
  });
  await createUser({
    email: "member@example.com",
    password: "a-long-password",
  });
  adminCookie = await loginCookie(app, "admin@example.com", "a-long-password");
  memberCookie = await loginCookie(
    app,
    "member@example.com",
    "a-long-password",
  );
});

afterEach(() => disableVault());

describe("MCP server admin", () => {
  it("lets an admin save, test, refresh and expose; a member only reads", async () => {
    const admin = as(adminCookie);
    const member = as(memberCookie);
    expect((await member("/api/mcp-servers", "POST", server())).status).toBe(
      403,
    );
    expect((await admin("/api/mcp-servers", "POST", server())).status).toBe(
      200,
    );

    const untested = (await (
      await admin("/api/mcp-servers/hub/test", "POST")
    ).json()) as {
      ok: boolean;
      error: string;
    };
    expect(untested).toEqual({
      ok: false,
      error: "add a token to 'hub''s pool first",
    });

    expect(
      (
        await admin("/api/mcp-servers/hub/credentials/svc-a", "PUT", {
          value: TOKENS.ok,
        })
      ).status,
    ).toBe(200);
    const tested = await (
      await admin("/api/mcp-servers/hub/test", "POST")
    ).json();
    expect(tested).toMatchObject({
      ok: true,
      tools: 5,
      server: { name: "fake-remote" },
    });

    const refreshed = await (
      await admin("/api/mcp-servers/hub/refresh", "POST")
    ).json();
    expect(refreshed).toMatchObject({ total: 5 });
    const exposed = await admin(
      "/api/mcp-servers/hub/tools/unhinted_lookup",
      "PUT",
      {
        exposed: true,
        attested: true,
      },
    );
    expect(await exposed.json()).toMatchObject({ exposed: true });

    const listed = (await (await member("/api/mcp-servers")).json()) as {
      servers: { slug: string; exposed: number; tools: number }[];
    };
    expect(listed.servers).toMatchObject([
      { slug: "hub", tools: 5, exposed: 4 },
    ]);
    expect(JSON.stringify(listed)).not.toContain(TOKENS.ok);
    const tools = (await (
      await member("/api/mcp-servers/hub/tools")
    ).json()) as unknown[];
    expect(tools).toHaveLength(5);
    expect((await member("/api/mcp-servers/hub/credentials")).status).toBe(403);
    const pool = await (await admin("/api/mcp-servers/hub/credentials")).json();
    expect(pool).toMatchObject([
      { label: "svc-a", usage: [{ seconds: 60, calls: 0, limit: 15 }] },
    ]);
    expect(JSON.stringify(pool)).not.toContain(TOKENS.ok);

    const actions =
      await sql`select action, target from audit_events order by id`;
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "mcp_server_save",
        "mcp_server_credential_set",
        "mcp_server_tool_expose",
      ]),
    );
  });

  it("tests a personal server with the admin's own token", async () => {
    const admin = as(adminCookie);
    await admin("/api/mcp-servers", "POST", server("personal"));
    const missing = await (
      await admin("/api/mcp-servers/hub/test", "POST")
    ).json();
    expect(missing).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Settings › agent/),
    });
    await admin("/api/me/credentials/mcp_token:hub", "PUT", {
      value: TOKENS.ok,
    });
    const tested = await (
      await admin("/api/mcp-servers/hub/test", "POST")
    ).json();
    expect(tested).toMatchObject({ ok: true });
  });

  it("lists the personal servers a person reaches, apart from their keys", async () => {
    await as(adminCookie)("/api/mcp-servers", "POST", server("personal"));
    const keys = (await (
      await as(memberCookie)("/api/me/credentials")
    ).json()) as {
      effective: Record<string, string | null>;
      mcp_servers: { slug: string; name: string; credential: string }[];
    };
    expect(keys.effective).not.toHaveProperty("mcp_token:hub");
    expect(keys.mcp_servers).toEqual([
      { slug: "hub", name: expect.any(String), credential: "mcp_token:hub" },
    ]);
  });

  it("names a pool token by label when testing, and drops one", async () => {
    const admin = as(adminCookie);
    await admin("/api/mcp-servers", "POST", server());
    await admin("/api/mcp-servers/hub/credentials/svc-a", "PUT", {
      value: TOKENS.ok,
    });
    await admin("/api/mcp-servers/hub/credentials/svc-b", "PUT", {
      value: TOKENS.refused,
    });
    const refused = await (
      await admin("/api/mcp-servers/hub/test?label=svc-b", "POST")
    ).json();
    expect(refused).toMatchObject({
      ok: false,
      error: expect.stringMatching(/refused the token/),
    });
    const unknown = await (
      await admin("/api/mcp-servers/hub/test?label=nope", "POST")
    ).json();
    expect(unknown).toMatchObject({
      ok: false,
      error: "no pool token labelled 'nope'",
    });
    expect(
      await (
        await admin("/api/mcp-servers/hub/credentials/svc-b", "DELETE")
      ).json(),
    ).toEqual({ deleted: true });
    expect(
      (
        await admin("/api/mcp-servers/hub/credentials/Bad Label", "PUT", {
          value: "x",
        })
      ).status,
    ).toBe(400);
  });

  it("counts linked servers in the overview and deletes one", async () => {
    const admin = as(adminCookie);
    await admin("/api/mcp-servers", "POST", server());
    const overview = (await (await admin("/api/overview")).json()) as {
      counts: Record<string, number>;
    };
    expect(overview.counts.mcp_servers).toBe(1);
    expect((await admin("/api/mcp-servers/hub", "DELETE")).status).toBe(200);
    expect((await admin("/api/mcp-servers/hub")).status).toBe(404);
  });

  it("refuses a pool token while the vault is off", async () => {
    disableVault();
    const admin = as(adminCookie);
    await admin("/api/mcp-servers", "POST", server());
    const response = await admin(
      "/api/mcp-servers/hub/credentials/svc-a",
      "PUT",
      {
        value: TOKENS.ok,
      },
    );
    expect(response.status).toBe(400);
  });
});
