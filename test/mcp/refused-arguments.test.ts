/** Arguments a read tool refuses instead of answering for a wider scope than asked. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "../../packages/mcp/src/index";
import { resetData, sql } from "../database";

afterAll(() => sql.end());

let client: Client;

async function call(name: string, args: Record<string, unknown>) {
  const answer = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return {
    isError: answer.isError === true,
    text: answer.content[0]?.text ?? "",
  };
}

beforeAll(async () => {
  await resetData();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(() => client.close());

describe("a component filter without its product", () => {
  it("is refused where it was dropped", async () => {
    for (const tool of [
      "search_knowledge",
      "search_reference",
      "list_knowledge_entries",
      "list_reference_docs",
    ]) {
      const answer = await call(tool, { query: "x", component: "renderer" });
      expect(answer, tool).toMatchObject({
        isError: true,
        text: "component needs product_slug to resolve against",
      });
    }
    expect(await call("list_repos", { component: "renderer" })).toMatchObject({
      isError: true,
    });
  });
});

describe("list_ado_wikis", () => {
  it("asks for a source or a product when given neither", async () => {
    expect(await call("list_ado_wikis", {})).toEqual({
      isError: true,
      text: "pass source or product_slug",
    });
  });
});
