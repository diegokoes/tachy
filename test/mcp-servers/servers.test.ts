import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_PROXIED_NAME_CHARS,
  mcpServerCredentialName,
  proxiedToolName,
} from "@tachy/core";
import { createUser, setTeamMember } from "@tachy/core/access";
import { addTeam } from "@tachy/core/catalog";
import {
  envCredential,
  resolveCredential,
  setCredential,
} from "@tachy/core/config";
import {
  coolDown,
  cooldownEnd,
  credentialStates,
  deleteMcpServer,
  deletePoolToken,
  getMcpServer,
  listMcpServers,
  listPoolCredentials,
  ownToken,
  pickCredential,
  poolTokens,
  reserveCall,
  resolveTurnServers,
  readTurnTokens,
  saveMcpServer,
  serversFor,
  setPoolToken,
  storeToolList,
  sweepUsage,
  windowEnd,
  DEFAULT_COOLDOWN_SECONDS,
  type McpServerInput,
} from "@tachy/core/mcp-servers";
import { resetData, sql } from "../database";
import { disableVault, enableVault } from "../vault";

afterAll(() => sql.end());

const httpServer = (
  overrides: Partial<McpServerInput> = {},
): McpServerInput => ({
  slug: "hub",
  name: "Hub",
  transport: "http",
  config: {
    url: "https://hub.example.invalid/agents/mcp",
    headers: { Authorization: "Bearer {{token}}" },
  },
  credentialMode: "shared",
  toolPrefix: "hub",
  ...overrides,
});

let adminId = "";

beforeEach(async () => {
  await resetData();
  enableVault();
  adminId = (await createUser({ email: "root@example.com", role: "admin" })).id;
});

afterEach(() => {
  disableVault();
  delete process.env.TACHY_MCP_STDIO_COMMANDS;
});

describe("proxied tool names", () => {
  it("joins prefix and name and replaces characters a tool name cannot hold", () => {
    expect(proxiedToolName("hub", "monitoringevents_search")).toBe(
      "hub_monitoringevents_search",
    );
    expect(proxiedToolName("hub", "events.search/v2")).toBe(
      "hub_events_search_v2",
    );
  });

  it("cuts a long name to the limit and keeps two long names apart", () => {
    const long = "a".repeat(80);
    const first = proxiedToolName("hub", `${long}_one`);
    const second = proxiedToolName("hub", `${long}_two`);
    expect(first.length).toBe(MAX_PROXIED_NAME_CHARS);
    expect(first).not.toBe(second);
    expect(proxiedToolName("hub", `${long}_one`)).toBe(first);
  });
});

describe("credential names", () => {
  it("accepts a pool member's three-part name in the vault", async () => {
    const name = mcpServerCredentialName("hub", "svc-1");
    expect(name).toBe("mcp_token:hub:svc-1");
    await setCredential(
      adminId,
      "global",
      undefined,
      name,
      "pool-secret-value",
    );
    expect(await resolveCredential(name, {})).toBe("pool-secret-value");
  });

  it("never answers a server token from the environment", () => {
    process.env.MCP_TOKEN_HUB = "from-env";
    expect(envCredential("mcp_token:hub")).toBeUndefined();
    delete process.env.MCP_TOKEN_HUB;
  });
});

describe("servers", () => {
  it("saves, lists and replaces a server by slug", async () => {
    const saved = await saveMcpServer(
      httpServer({ rateWindows: [{ seconds: 60, limit: 15 }] }),
      adminId,
    );
    expect(saved).toMatchObject({
      slug: "hub",
      transport: "http",
      credential_mode: "shared",
      rate_windows: [{ seconds: 60, limit: 15 }],
      teams: [],
      tools: 0,
    });
    await saveMcpServer(httpServer({ name: "Hub preprod" }), adminId);
    const servers = await listMcpServers();
    expect(servers.map((server) => server.name)).toEqual(["Hub preprod"]);
  });

  it.each([
    [{ slug: "Bad Slug" }, /slug/],
    [{ toolPrefix: "9hub" }, /prefix/],
    [{ config: { url: "ftp://hub.example.invalid" } }, /url/],
    [{ config: { url: "https://user:pw@hub.example.invalid" } }, /url/],
    [{ rateWindows: [{ seconds: 60, limit: 0 }] }, /limit/],
    [{ argumentBindings: { customer: "" } }, /fact kind/],
  ] as [Partial<McpServerInput>, RegExp][])(
    "refuses an invalid server %#",
    async (overrides, message) => {
      await expect(
        saveMcpServer(httpServer(overrides), adminId),
      ).rejects.toThrow(message);
    },
  );

  it("refuses a tool prefix another server already uses", async () => {
    await saveMcpServer(httpServer(), adminId);
    await expect(
      saveMcpServer(httpServer({ slug: "hub-2" }), adminId),
    ).rejects.toThrow(/already used by 'hub'/);
  });

  it("starts a stdio server only with a command on the host's list", async () => {
    const stdio = httpServer({
      transport: "stdio",
      config: { command: "/usr/bin/gateway", args: ["mcp"] },
    });
    await expect(saveMcpServer(stdio, adminId)).rejects.toThrow(
      /TACHY_MCP_STDIO_COMMANDS/,
    );
    process.env.TACHY_MCP_STDIO_COMMANDS = "/usr/bin/other, /usr/bin/gateway";
    await expect(saveMcpServer(stdio, adminId)).resolves.toMatchObject({
      transport: "stdio",
    });
  });

  it("keeps a stdio server's files inside its directory", async () => {
    process.env.TACHY_MCP_STDIO_COMMANDS = "/usr/bin/gateway";
    const files = (path: string) =>
      httpServer({
        transport: "stdio",
        config: {
          command: "/usr/bin/gateway",
          files: [{ path, content: "x" }],
        },
      });
    await expect(saveMcpServer(files("../escape"), adminId)).rejects.toThrow(
      /leaves its directory/,
    );
    await expect(saveMcpServer(files("/etc/passwd"), adminId)).rejects.toThrow(
      /relative/,
    );
  });

  it("offers a server with teams only to their members", async () => {
    await addTeam("ops", "Ops");
    const member = await createUser({ email: "op@example.com" });
    const outsider = await createUser({ email: "dev@example.com" });
    await setTeamMember("ops", "op@example.com", "member");
    await saveMcpServer(httpServer({ teams: ["ops"] }), adminId);
    await saveMcpServer(
      httpServer({ slug: "open", toolPrefix: "open" }),
      adminId,
    );
    await saveMcpServer(
      httpServer({ slug: "off", toolPrefix: "off", enabled: false }),
      adminId,
    );
    const slugs = async (userId: string | null) =>
      (await serversFor(userId)).map((server) => server.slug);
    expect(await slugs(member.id)).toEqual(["hub", "open"]);
    expect(await slugs(outsider.id)).toEqual(["open"]);
    expect(await slugs(null)).toEqual(["open"]);
  });

  it("deletes a server with every token saved for it, and only those", async () => {
    await saveMcpServer(httpServer(), adminId);
    await saveMcpServer(
      httpServer({ slug: "hub-x", toolPrefix: "hubx" }),
      adminId,
    );
    await setPoolToken(adminId, "hub", "svc", "hub-pool-token-1");
    await setPoolToken(adminId, "hub-x", "svc", "hubx-pool-token-1");
    await setCredential(
      adminId,
      "user",
      adminId,
      "mcp_token:hub",
      "mine-token-1",
    );
    await deleteMcpServer("hub");
    const names = await sql`select name from credentials order by name`;
    expect(names.map((row) => row.name)).toEqual(["mcp_token:hub-x:svc"]);
    await expect(getMcpServer("hub")).rejects.toThrow(/not found/);
  });
});

describe("tokens", () => {
  it("reads a personal token from the person's own row only", async () => {
    const member = await createUser({ email: "op@example.com" });
    await setCredential(
      adminId,
      "global",
      undefined,
      "mcp_token:hub",
      "org-token-1",
    );
    expect(await ownToken("hub", member.id)).toBeNull();
    await setCredential(
      member.id,
      "user",
      member.id,
      "mcp_token:hub",
      "own-token-1",
    );
    expect(await ownToken("hub", member.id)).toEqual({
      key: `user:${member.id}`,
      token: "own-token-1",
    });
  });

  it("lists the pool by label and drops a member", async () => {
    const server = await saveMcpServer(
      httpServer({ rateWindows: [{ seconds: 60, limit: 2 }] }),
      adminId,
    );
    await setPoolToken(adminId, "hub", "svc-a", "pool-token-aaaa");
    await setPoolToken(adminId, "hub", "svc-b", "pool-token-bbbb");
    expect(await poolTokens("hub")).toEqual([
      { key: "shared:svc-a", token: "pool-token-aaaa" },
      { key: "shared:svc-b", token: "pool-token-bbbb" },
    ]);
    await reserveCall(server.id, "shared:svc-a", server.rate_windows);
    const listed = await listPoolCredentials(server);
    expect(listed.map((entry) => [entry.label, entry.usage[0]?.calls])).toEqual(
      [
        ["svc-a", 1],
        ["svc-b", 0],
      ],
    );
    expect(JSON.stringify(listed)).not.toContain("pool-token");
    expect(await deletePoolToken(adminId, "hub", "svc-a")).toBe(true);
    expect((await poolTokens("hub")).map((entry) => entry.key)).toEqual([
      "shared:svc-b",
    ]);
    await expect(
      setPoolToken(adminId, "hub", "Bad Label", "x-token-1"),
    ).rejects.toThrow(/label/);
  });
});

describe("budget", () => {
  const windows = [
    { seconds: 60, limit: 2 },
    { seconds: 3600, limit: 3 },
  ];
  let serverId = "";
  beforeEach(async () => {
    serverId = (await saveMcpServer(httpServer(), adminId)).id;
  });

  it("stops at the first full window and takes nothing from the others", async () => {
    const at = new Date("2026-10-15T10:00:10Z");
    expect(await reserveCall(serverId, "shared:a", windows, at)).toBe(true);
    expect(await reserveCall(serverId, "shared:a", windows, at)).toBe(true);
    expect(await reserveCall(serverId, "shared:a", windows, at)).toBe(false);
    const [state] = await credentialStates(serverId, ["shared:a"], windows, at);
    expect(state!.usage.map((window) => window.calls)).toEqual([2, 2]);
    expect(state!.blockedUntil).toEqual(new Date("2026-10-15T10:01:00Z"));
    const nextMinute = new Date("2026-10-15T10:01:05Z");
    expect(await reserveCall(serverId, "shared:a", windows, nextMinute)).toBe(
      true,
    );
    expect(await reserveCall(serverId, "shared:a", windows, nextMinute)).toBe(
      false,
    );
  });

  it("never lets concurrent reservations past the limit", async () => {
    const at = new Date("2026-10-15T11:00:00Z");
    const granted = await Promise.all(
      Array.from({ length: 10 }, () =>
        reserveCall(serverId, "shared:a", [{ seconds: 60, limit: 4 }], at),
      ),
    );
    expect(granted.filter(Boolean)).toHaveLength(4);
  });

  it("counts nothing for a server with no windows", async () => {
    expect(await reserveCall(serverId, "shared:a", [])).toBe(true);
    const rows = await sql`select * from mcp_server_usage`;
    expect(rows).toHaveLength(0);
  });

  it("spreads a pool over its least used credential and skips one that rests", async () => {
    const at = new Date("2026-10-15T12:00:00Z");
    const pool = [
      { key: "shared:a" },
      { key: "shared:b" },
      { key: "shared:c" },
    ];
    await reserveCall(serverId, "shared:a", windows, at);
    await coolDown(serverId, "shared:b", new Date("2026-10-15T12:05:00Z"));
    const pick = await pickCredential(serverId, pool, windows, at);
    expect(pick).toEqual({ credential: { key: "shared:c" } });
  });

  it("says when the first credential frees up once all are spent", async () => {
    const at = new Date("2026-10-15T13:00:30Z");
    const pool = [{ key: "shared:a" }, { key: "shared:b" }];
    await coolDown(serverId, "shared:a", new Date("2026-10-15T13:30:00Z"));
    await reserveCall(serverId, "shared:b", windows, at);
    await reserveCall(serverId, "shared:b", windows, at);
    expect(await pickCredential(serverId, pool, windows, at)).toEqual({
      resetsAt: new Date("2026-10-15T13:01:00Z"),
    });
    expect(await pickCredential(serverId, [], windows, at)).toEqual({
      resetsAt: null,
    });
  });

  it("rests a rate-limited credential until its shortest window ends", () => {
    const at = new Date("2026-10-15T14:00:20Z");
    expect(cooldownEnd(windows, at)).toEqual(windowEnd(at, 60));
    expect(cooldownEnd([], at)).toEqual(
      new Date(at.getTime() + DEFAULT_COOLDOWN_SECONDS * 1000),
    );
  });

  it("never shortens a rest and sweeps closed windows", async () => {
    await coolDown(serverId, "shared:a", new Date(Date.now() + 600_000));
    await coolDown(serverId, "shared:a", new Date(Date.now() + 60_000));
    const [rest] = await sql`select until from mcp_server_cooldowns`;
    expect(new Date(rest!.until).getTime()).toBeGreaterThan(
      Date.now() + 500_000,
    );
    await reserveCall(
      serverId,
      "shared:a",
      windows,
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(await sweepUsage()).toBe(2);
  });
});

describe("a turn's servers", () => {
  it("hands a turn the person's own token, the pool, and their exposed tools", async () => {
    const member = await createUser({ email: "op@example.com" });
    const personal = await saveMcpServer(
      httpServer({
        slug: "mine",
        toolPrefix: "mine",
        credentialMode: "personal",
      }),
      adminId,
    );
    const shared = await saveMcpServer(httpServer(), adminId);
    await storeToolList(personal.id, [
      {
        name: "whoami",
        inputSchema: { type: "object" },
        annotations: { readOnlyHint: true },
      },
    ]);
    await storeToolList(shared.id, [
      {
        name: "events_search",
        inputSchema: { type: "object" },
        annotations: { readOnlyHint: true },
      },
      { name: "unhinted", inputSchema: { type: "object" } },
    ]);
    await setPoolToken(adminId, "hub", "svc", "pool-token-turn");

    const without = await resolveTurnServers(member.id);
    expect(without.servers).toEqual([
      { slug: "hub", credential: "shared", tools: 1 },
      { slug: "mine", credential: "missing", tools: 0 },
    ]);
    expect(without.proxiedTools).toEqual(["hub_events_search"]);
    expect(Object.keys(without.tokens)).toEqual(["hub"]);

    await setCredential(
      member.id,
      "user",
      member.id,
      "mcp_token:mine",
      "own-turn-token",
    );
    const withOwn = await resolveTurnServers(member.id);
    expect(withOwn.proxiedTools.sort()).toEqual([
      "hub_events_search",
      "mine_whoami",
    ]);
    expect(readTurnTokens(JSON.stringify(withOwn.tokens))).toEqual({
      hub: [{ key: "shared:svc", token: "pool-token-turn" }],
      mine: [{ key: `user:${member.id}`, token: "own-turn-token" }],
    });
    const other = await createUser({ email: "dev@example.com" });
    expect((await resolveTurnServers(other.id)).tokens.mine).toBeUndefined();
  });

  it("reads no tokens from a missing or broken env value", () => {
    expect(readTurnTokens(undefined)).toEqual({});
    expect(readTurnTokens("{not json")).toEqual({});
    expect(readTurnTokens("42")).toEqual({});
  });
});
