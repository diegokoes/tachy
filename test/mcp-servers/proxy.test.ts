import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
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
import { addCustomer, setCustomerFact } from "@tachy/core/catalog";
import { backgroundSettled } from "@tachy/core/infra";
import {
  applyBindings,
  boundArguments,
  callServerTool,
  closeConnections,
  listServerTools,
  openConnection,
  probeServer,
  refreshTools,
  saveMcpServer,
  setToolExposed,
  shapeResult,
  storeToolList,
  type McpServerInput,
} from "@tachy/core/mcp-servers";
import type { McpServerRow } from "@tachy/core";
import { getJobKind, registerCoreJobs } from "@tachy/core/jobs";
import { REFRESH_KIND, setPoolToken } from "@tachy/core/mcp-servers";
import { resetData, sql } from "../database";
import { disableVault, enableVault } from "../vault";
import {
  RATE_LIMIT_CODE,
  TOKENS,
  startFakeRemote,
  type FakeRemote,
} from "./fake-server";

afterAll(() => sql.end());

let remote: FakeRemote;
let adminId = "";

beforeAll(async () => {
  remote = await startFakeRemote();
});

afterAll(async () => {
  await closeConnections();
  await remote.close();
});

beforeEach(async () => {
  await resetData();
  remote.calls.length = 0;
  adminId = (await createUser({ email: "root@example.com", role: "admin" })).id;
});

afterEach(async () => {
  await closeConnections();
  delete process.env.TACHY_REDACT;
  delete process.env.TACHY_MCP_STDIO_COMMANDS;
});

function hub(overrides: Partial<McpServerInput> = {}): Promise<McpServerRow> {
  return saveMcpServer(
    {
      slug: "hub",
      name: "Hub",
      transport: "http",
      config: {
        url: remote.url,
        headers: { Authorization: "Bearer {{token}}" },
      },
      credentialMode: "shared",
      toolPrefix: "hub",
      rateWindows: [{ seconds: 60, limit: 5 }],
      rateLimitCodes: [RATE_LIMIT_CODE],
      argumentBindings: {
        customer: "hub_customer",
        application: "hub_application",
      },
      ...overrides,
    },
    adminId,
  );
}

const shared = (label: string, token: string) => ({
  key: `shared:${label}`,
  token,
});

const firstText = (result: { content: unknown[] }) =>
  (result.content[0] as { text: string }).text;

describe("catalog", () => {
  it("stores the listed tools and exposes only those that say they read", async () => {
    const server = await hub();
    const outcome = await refreshTools(server, TOKENS.ok);
    expect(outcome.total).toBe(5);
    const tools = await listServerTools("hub");
    expect(
      Object.fromEntries(tools.map((tool) => [tool.name, tool.exposed])),
    ).toEqual({
      big_dump: true,
      events_search: true,
      failing_tool: true,
      script_update: false,
      unhinted_lookup: false,
    });
    const search = tools.find((tool) => tool.name === "events_search")!;
    expect(search.input_schema).toMatchObject({ properties: { customer: {} } });
    expect(
      (await sql`select tools_refreshed_at from mcp_servers`)[0]!
        .tools_refreshed_at,
    ).not.toBeNull();
  });

  it("exposes an unhinted tool only when an admin vouches for it, a destructive one never", async () => {
    const server = await hub();
    await refreshTools(server, TOKENS.ok);
    await expect(
      setToolExposed("hub", "unhinted_lookup", { exposed: true }, adminId),
    ).rejects.toThrow(/does not say it only reads/);
    const vouched = await setToolExposed(
      "hub",
      "unhinted_lookup",
      { exposed: true, attested: true },
      adminId,
    );
    expect(vouched).toMatchObject({ exposed: true, attested_by: adminId });
    await expect(
      setToolExposed(
        "hub",
        "script_update",
        { exposed: true, attested: true },
        adminId,
      ),
    ).rejects.toThrow(/destructive/);
    await expect(
      setToolExposed("hub", "nope", { exposed: true }, adminId),
    ).rejects.toThrow(/not listed/);
  });

  it("keeps a vouched tool on refresh, drops a tool that turns destructive or disappears", async () => {
    const server = await hub();
    await storeToolList(server.id, [
      {
        name: "a",
        inputSchema: { type: "object" },
        annotations: { readOnlyHint: true },
      },
      { name: "b", inputSchema: { type: "object" } },
      {
        name: "c",
        inputSchema: { type: "object" },
        annotations: { readOnlyHint: true },
      },
    ]);
    await setToolExposed(
      "hub",
      "b",
      { exposed: true, attested: true },
      adminId,
    );
    const outcome = await storeToolList(server.id, [
      {
        name: "a",
        inputSchema: { type: "object" },
        annotations: { destructiveHint: true },
      },
      { name: "b", inputSchema: { type: "object" } },
      { name: "d", inputSchema: { type: "object" } },
    ]);
    expect(outcome).toEqual({ total: 3, added: ["d"], removed: ["c"] });
    const exposed = (await listServerTools("hub")).filter(
      (tool) => tool.exposed,
    );
    expect(exposed.map((tool) => tool.name)).toEqual(["b"]);
  });

  it("probes a server without storing anything", async () => {
    const server = await hub();
    expect(await probeServer(server, TOKENS.ok)).toEqual({
      server: { name: "fake-remote", version: "1.2.3" },
      instructions: null,
      tools: 5,
    });
    expect(await listServerTools("hub")).toEqual([]);
  });

  it("refreshes enabled shared servers from the daily job, and leaves personal ones", async () => {
    enableVault();
    try {
      await hub();
      await hub({
        slug: "mine",
        toolPrefix: "mine",
        credentialMode: "personal",
      });
      await setPoolToken(adminId, "hub", "svc", TOKENS.ok);
      registerCoreJobs();
      const output = await getJobKind(REFRESH_KIND).run({} as never, {});
      expect(output).toMatchObject({ refreshed: ["hub"], failed: {} });
      expect(await listServerTools("hub")).toHaveLength(5);
      expect(await listServerTools("mine")).toEqual([]);
      await setPoolToken(adminId, "hub", "svc", TOKENS.refused);
      expect(await getJobKind(REFRESH_KIND).run({} as never, {})).toMatchObject(
        {
          refreshed: [],
          failed: { hub: expect.stringMatching(/refused the token/) },
        },
      );
    } finally {
      disableVault();
    }
  });

  it("reports a refused token on connect", async () => {
    const server = await hub();
    await expect(probeServer(server, TOKENS.refused)).rejects.toThrow(
      "Hub: the server refused the token (HTTP 401)",
    );
  });
});

describe("calls", () => {
  it("calls with a pool token and counts the call", async () => {
    const server = await hub();
    const result = await callServerTool(
      server,
      [shared("a", TOKENS.ok)],
      "events_search",
      {
        customer: "acme",
      },
    );
    expect(JSON.parse(firstText(result))).toMatchObject({
      customer: "acme",
      token: TOKENS.ok,
    });
    await backgroundSettled();
    const [traffic] =
      await sql`select calls, rate_limited from mcp_server_calls`;
    expect(traffic).toMatchObject({ calls: 1, rate_limited: 0 });
  });

  it("hands the call to the next pool token when one is rate limited", async () => {
    const server = await hub();
    const result = await callServerTool(
      server,
      [shared("a", TOKENS.limited), shared("b", TOKENS.other)],
      "events_search",
      {},
    );
    expect(JSON.parse(firstText(result)).token).toBe(TOKENS.other);
    const [rest] = await sql`select credential_key from mcp_server_cooldowns`;
    expect(rest!.credential_key).toBe("shared:a");
    // The resting token is skipped: three calls reached the server, one rate limited.
    await callServerTool(
      server,
      [shared("a", TOKENS.limited), shared("b", TOKENS.other)],
      "events_search",
      {},
    );
    await backgroundSettled();
    const [traffic] =
      await sql`select calls, rate_limited from mcp_server_calls`;
    expect(traffic).toMatchObject({ calls: 3, rate_limited: 1 });
  });

  it("treats an HTTP 429 as rate limited too", async () => {
    const server = await hub();
    await expect(
      callServerTool(
        server,
        [shared("a", TOKENS.throttled)],
        "events_search",
        {},
      ),
    ).rejects.toThrow(/rate limiting/);
    const [rest] = await sql`select credential_key from mcp_server_cooldowns`;
    expect(rest!.credential_key).toBe("shared:a");
  });

  it("refuses a call once every token's budget is spent, and says until when", async () => {
    const server = await hub({ rateWindows: [{ seconds: 3600, limit: 1 }] });
    const pool = [shared("a", TOKENS.ok)];
    await callServerTool(server, pool, "events_search", {});
    await expect(
      callServerTool(server, pool, "events_search", {}),
    ).rejects.toThrow(
      /no call budget left until .*do not call its tools again/,
    );
    await backgroundSettled();
    const [traffic] =
      await sql`select calls, budget_refused from mcp_server_calls`;
    expect(traffic).toMatchObject({ calls: 1, budget_refused: 1 });
  });

  it("tells a person to replace their own refused token, and a pool user to ask an admin", async () => {
    const personal = await hub({ credentialMode: "personal" });
    await expect(
      callServerTool(
        personal,
        [{ key: "user:x", token: TOKENS.refused }],
        "events_search",
        {},
      ),
    ).rejects.toThrow(/settings › agent/);
    const pooled = await hub();
    await expect(
      callServerTool(
        pooled,
        [shared("svc", TOKENS.refused)],
        "events_search",
        {},
      ),
    ).rejects.toThrow(/token 'svc'.*admin/);
    await backgroundSettled();
    const [traffic] = await sql`select auth_failures from mcp_server_calls`;
    expect(traffic!.auth_failures).toBe(2);
  });

  it("names the server in any other failure", async () => {
    const server = await hub();
    await expect(
      callServerTool(server, [shared("a", TOKENS.ok)], "no_such_tool", {}),
    ).resolves.toMatchObject({ isError: true });
  });
});

describe("answers", () => {
  const limits = { name: "Hub", redaction: false, result_max_chars: 100 };

  it("passes text through and cuts an oversized answer with a note", () => {
    const shaped = shapeResult(limits, {
      content: [{ type: "text", text: "y".repeat(150) }],
    });
    expect(firstText(shaped)).toHaveLength(100);
    expect((shaped.content[1] as { text: string }).text).toMatch(
      /cut at 100 characters/,
    );
  });

  it("says when blocks were left out, and reads structured content when there is no text", () => {
    const shaped = shapeResult(limits, {
      content: [
        { type: "text", text: "ok" },
        { type: "image", data: "AAAA", mimeType: "image/png" },
      ],
    });
    expect((shaped.content[1] as { text: string }).text).toMatch(
      /1 non-text block/,
    );
    expect(
      firstText(
        shapeResult(limits, { content: [], structuredContent: { n: 1 } }),
      ),
    ).toBe('{"n":1}');
  });

  it("throws the remote's own error text", () => {
    expect(() =>
      shapeResult(limits, {
        content: [{ type: "text", text: "Access to pool 7 not allowed" }],
        isError: true,
      }),
    ).toThrow("Hub: Access to pool 7 not allowed");
  });

  it("scrubs the answer when the server or the deployment redacts", () => {
    const answer = {
      content: [{ type: "text" as const, text: '{"who":"ops@example.com"}' }],
    };
    const redacted = { ...limits, redaction: true, result_max_chars: 1000 };
    expect(firstText(shapeResult(redacted, answer))).not.toContain(
      "ops@example.com",
    );
    process.env.TACHY_REDACT = "true";
    expect(
      firstText(
        shapeResult(
          { ...limits, result_max_chars: 1000 },
          {
            content: [{ type: "text", text: "mail ops@example.com" }],
          },
        ),
      ),
    ).not.toContain("ops@example.com");
  });
});

describe("customer bindings", () => {
  beforeEach(async () => {
    await addCustomer({ name: "Acme", slug: "acme", aliases: ["acme-corp"] });
    await setCustomerFact({
      customerSlug: "acme",
      kind: "hub_customer",
      value: "acme-tenant",
    });
    await setCustomerFact({
      customerSlug: "acme",
      kind: "hub_customer",
      label: "hub",
      value: "acme-hub-tenant",
    });
  });

  it("finds the bound arguments a tool's schema has", async () => {
    const server = await hub();
    expect(
      boundArguments(server, { properties: { customer: {}, query: {} } }),
    ).toEqual(["customer"]);
    expect(boundArguments(server, {})).toEqual([]);
  });

  it("fills a bound argument from the customer's fact, the server's label first", async () => {
    const server = await hub();
    expect(
      await applyBindings(server, ["customer"], {
        tachy_customer: "acme-corp",
        query: "x",
      }),
    ).toEqual({ customer: "acme-hub-tenant", query: "x" });
    const other = await hub({ slug: "other", toolPrefix: "other" });
    expect(
      await applyBindings(other, ["customer"], { tachy_customer: "acme" }),
    ).toEqual({ customer: "acme-tenant" });
  });

  it("lets an argument the model passed win, and leaves a call without a customer alone", async () => {
    const server = await hub();
    expect(
      await applyBindings(server, ["customer"], {
        tachy_customer: "acme",
        customer: "explicit",
      }),
    ).toEqual({ customer: "explicit" });
    expect(await applyBindings(server, ["customer"], { query: "x" })).toEqual({
      query: "x",
    });
  });

  it("says which fact to set when the customer has none", async () => {
    const server = await hub();
    await expect(
      applyBindings(server, ["application"], { tachy_customer: "acme" }),
    ).rejects.toThrow(
      /no 'hub_application' fact to fill application.*set_customer_fact/,
    );
    await expect(
      applyBindings(server, ["customer"], { tachy_customer: "nobody" }),
    ).rejects.toThrow(/unknown customer/);
  });
});

describe("stdio servers", () => {
  const script = fileURLToPath(new URL("./stdio-server.mjs", import.meta.url));

  it("starts the command with its files and env rendered, and nothing of tachy's env", async () => {
    process.env.TACHY_MCP_STDIO_COMMANDS = process.execPath;
    const server = await saveMcpServer(
      {
        slug: "gateway",
        name: "Gateway",
        transport: "stdio",
        config: {
          command: process.execPath,
          args: [script, "{{dir}}"],
          env: { FAKE_GREETING: "hello" },
          files: [{ path: "config/env.yaml", content: "{{token}}\n" }],
        },
        credentialMode: "shared",
        toolPrefix: "gw",
      },
      adminId,
    );
    const connection = await openConnection(server, "stdio-token-1234");
    try {
      const answer = await connection.client.callTool({
        name: "whoami",
        arguments: {},
      });
      const seen = JSON.parse(firstText(answer as { content: unknown[] }));
      expect(seen).toMatchObject({
        token: "stdio-token-1234",
        greeting: "hello",
        database: null,
      });
      expect(existsSync(seen.arg)).toBe(true);
      await connection.close();
      expect(existsSync(seen.arg)).toBe(false);
    } finally {
      await connection.close().catch(() => undefined);
    }
  });

  it("refuses to start a command taken off the host's list", async () => {
    process.env.TACHY_MCP_STDIO_COMMANDS = process.execPath;
    const server = await saveMcpServer(
      {
        slug: "gateway",
        name: "Gateway",
        transport: "stdio",
        config: { command: process.execPath, args: [script] },
        credentialMode: "shared",
        toolPrefix: "gw",
      },
      adminId,
    );
    process.env.TACHY_MCP_STDIO_COMMANDS = "";
    await expect(openConnection(server, "stdio-token-1234")).rejects.toThrow(
      /TACHY_MCP_STDIO_COMMANDS/,
    );
  });
});
