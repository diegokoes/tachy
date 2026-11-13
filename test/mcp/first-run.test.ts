/** What the two lists that come back empty on a new system tell the agent to do. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "../../packages/mcp/src/index";
import { sql } from "../database";

vi.mock("@tachy/core/catalog", async (original) => ({
  ...(await original<typeof import("@tachy/core/catalog")>()),
  listTeams: async () => [],
}));
vi.mock("@tachy/core/sources", async (original) => ({
  ...(await original<typeof import("@tachy/core/sources")>()),
  listSourceConnections: async () => [],
}));

afterAll(() => sql.end());

let client: Client;

const answerOf = async (tool: string) => {
  const answer = (await client.callTool({ name: tool, arguments: {} })) as {
    content: { text: string }[];
  };
  return JSON.parse(answer.content[0].text) as Record<string, unknown>;
};

beforeAll(async () => {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(() => client.close());

describe("a system with no team and no source", () => {
  it("is told how to set up its first team", async () => {
    expect(await answerOf("list_teams")).toEqual({
      teams: [],
      note: expect.stringContaining("add_team"),
    });
  });

  it("is pointed at the console for its first source, never at a token", async () => {
    expect(await answerOf("list_source_connections")).toEqual({
      connections: [],
      note: expect.stringContaining("console › integrations › sources"),
    });
  });
});
