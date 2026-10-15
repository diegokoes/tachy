/** Linked servers' tools on tachy's MCP server, called through to the fake remote. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createUser } from "@tachy/core/access";
import { addCustomer, setCustomerFact } from "@tachy/core/catalog";
import { backgroundSettled } from "@tachy/core/infra";
import {
  closeConnections,
  readTurnTokens,
  refreshTools,
  saveMcpServer,
  setToolExposed,
  storeToolList,
} from "@tachy/core/mcp-servers";
import { registerProxiedTools, server } from "../../packages/mcp/src/index";
import { resetData, sql } from "../database";
import {
  RATE_LIMIT_CODE,
  TOKENS,
  startFakeRemote,
  type FakeRemote,
} from "./fake-server";

let remote: FakeRemote;
let client: Client;
let registered: string[] = [];

afterAll(async () => {
  await closeConnections();
  await remote.close();
  await sql.end();
});

beforeAll(async () => {
  await resetData();
  remote = await startFakeRemote();
  const root = await createUser({ email: "root@example.com", role: "admin" });
  const linked = await saveMcpServer(
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
      rateLimitCodes: [RATE_LIMIT_CODE],
      argumentBindings: { customer: "hub_customer" },
      resultMaxChars: 1000,
      note: "Times are epoch milliseconds.",
    },
    root.id,
  );
  await refreshTools(linked, TOKENS.ok);
  await setToolExposed(
    "hub",
    "unhinted_lookup",
    { exposed: true, attested: true },
    root.id,
  );
  // A server whose proxied name lands on one of tachy's own tools.
  const clash = await saveMcpServer(
    {
      slug: "clash",
      name: "Clash",
      transport: "http",
      config: { url: remote.url },
      credentialMode: "shared",
      toolPrefix: "post",
    },
    root.id,
  );
  await storeToolList(clash.id, [
    {
      name: "private_note",
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: true },
    },
  ]);
  // Not offered: the turn holds no credential for it.
  await saveMcpServer(
    {
      slug: "absent",
      name: "Absent",
      transport: "http",
      config: { url: remote.url },
      credentialMode: "shared",
      toolPrefix: "absent",
    },
    root.id,
  );
  await addCustomer({ name: "Acme", slug: "acme" });
  await setCustomerFact({
    customerSlug: "acme",
    kind: "hub_customer",
    value: "acme-tenant",
  });

  registered = await registerProxiedTools(
    readTurnTokens(
      JSON.stringify({
        hub: [
          { key: "shared:limited", token: TOKENS.limited },
          { key: "shared:ok", token: TOKENS.ok },
        ],
        clash: [{ key: "shared:ok", token: TOKENS.ok }],
      }),
    ),
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const answer = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  return {
    isError: answer.isError === true,
    texts: answer.content.map((block) => block.text),
  };
}

describe("linked-server tools on tachy's MCP server", () => {
  it("registers the exposed tools of servers the turn has tokens for, and nothing that clashes", async () => {
    expect(registered.sort()).toEqual([
      "hub_big_dump",
      "hub_events_search",
      "hub_failing_tool",
      "hub_unhinted_lookup",
    ]);
    const { tools } = await client.listTools();
    const names = tools.map((entry) => entry.name);
    expect(names).toContain("hub_events_search");
    expect(names).not.toContain("hub_script_update");
    expect(names.some((name) => name.startsWith("absent_"))).toBe(false);
    expect(names.filter((name) => name === "post_private_note")).toHaveLength(
      1,
    );
  });

  it("describes a tool with its server, its binding and the admin's note", async () => {
    const { tools } = await client.listTools();
    const search = tools.find((entry) => entry.name === "hub_events_search")!;
    expect(search.description).toContain("Searches monitoring events.");
    expect(search.description).toContain("[Hub, via tachy]");
    expect(search.description).toContain(
      "Pass tachy_customer to fill customer from that customer's hub_customer facts.",
    );
    expect(search.description).toContain("Times are epoch milliseconds.");
    expect(search.annotations?.readOnlyHint).toBe(true);
    expect(Object.keys(search.inputSchema.properties ?? {}).sort()).toEqual([
      "application",
      "customer",
      "query",
      "tachy_customer",
    ]);
  });

  it("fills the customer from the catalog, passes over a rate-limited token, and masks the token in the answer", async () => {
    const answer = await call("hub_events_search", {
      tachy_customer: "acme",
      query: "x",
    });
    expect(answer.isError).toBe(false);
    const payload = JSON.parse(answer.texts[0]!);
    expect(payload).toMatchObject({
      customer: "acme-tenant",
      token: "[SECRET]",
    });
    expect(remote.calls.at(-1)).toMatchObject({
      token: TOKENS.ok,
      args: { customer: "acme-tenant", query: "x" },
    });
    await backgroundSettled();
    const [counted] = await sql`
      select calls, failures, writes from mcp_tool_calls where tool = 'hub_events_search'
    `;
    expect(counted).toMatchObject({ calls: 1, failures: 0, writes: false });
  });

  it("cuts an oversized answer and says so", async () => {
    const answer = await call("hub_big_dump");
    expect(answer.texts[0]).toHaveLength(1000);
    expect(answer.texts[1]).toMatch(/cut at 1000 characters/);
  });

  it("returns the remote's error as an error result", async () => {
    const answer = await call("hub_failing_tool");
    expect(answer).toEqual({
      isError: true,
      texts: ["Hub: Access to pool 7 not allowed"],
    });
  });

  it("says which fact is missing instead of guessing a tenant", async () => {
    await addCustomer({ name: "Globex", slug: "globex" });
    const answer = await call("hub_events_search", {
      tachy_customer: "globex",
    });
    expect(answer.isError).toBe(true);
    expect(answer.texts[0]).toMatch(/globex has no 'hub_customer' fact/);
  });

  it("registers nothing for a turn with no tokens", async () => {
    expect(await registerProxiedTools({})).toEqual([]);
  });
});
