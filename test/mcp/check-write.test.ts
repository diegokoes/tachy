/**
 * The dry run the gate asks before it shows a review box: what each write
 * would be refused for, with nothing written.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createUser } from "@tachy/core/access";
import { listCustomers } from "@tachy/core/catalog";
import { CHECK_TOOL, env } from "@tachy/core/infra";
import { listKnowledgeEntries } from "@tachy/core/knowledge";
import { server } from "../../packages/mcp/src/index";
import { resetData, sql } from "../database";

afterAll(() => sql.end());

let client: Client;

interface Answered {
  isError: boolean;
  text: string;
}

async function call(name: string, args: Record<string, unknown>) {
  const answer = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return {
    isError: answer.isError === true,
    text: answer.content[0]?.text ?? "",
  } satisfies Answered;
}

const check = (tool: string, input: Record<string, unknown>) =>
  call(CHECK_TOOL, { tool, input });

const WOULD_RUN: Answered = { isError: false, text: "" };

const ENTRY = {
  product_slug: "tqx",
  title: "Label renderer drops the last row",
  issue_summary: "Label renderer drops the last row on long batches",
  symptoms: ["last row missing"],
  root_cause: "the renderer paginates before the final flush",
  resolution: "flush before paginating",
};

const OTHER_ENTRY = {
  product_slug: "tqx",
  title: "Scanner drops off the network after sleep",
  issue_summary: "Handhelds lose their lease when they wake.",
  resolution: "pin the lease on the access point",
};

// One identity for the file: the tools resolve the session's user once.
beforeAll(async () => {
  await resetData();
  await createUser({ email: "root@example.com", role: "admin" });
  env.actor = "agent";
  env.userEmail = "root@example.com";
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(() => client.close());

describe("check_write", () => {
  it("passes a write the caller may make, and writes nothing", async () => {
    expect(
      await check("add_customer", { name: "Dalmoor", slug: "dalmoor" }),
    ).toEqual(WOULD_RUN);
    expect(await listCustomers({})).toEqual([]);
  });

  it("names the slug an entry cannot be filed under", async () => {
    const unknownComponent = await check("save_knowledge_entry", {
      ...ENTRY,
      component: "no-such-part",
    });
    expect(unknownComponent.isError).toBe(true);
    expect(unknownComponent.text).toMatch(/no-such-part/);
    const unknownPattern = await check("save_knowledge_entry", {
      ...ENTRY,
      resolution_pattern: "no-such-pattern",
    });
    expect(unknownPattern.text).toMatch(/unknown resolution_pattern/);
  });

  it("passes an entry that would save, and saves none", async () => {
    expect(await check("save_knowledge_entry", ENTRY)).toEqual(WOULD_RUN);
    expect(await listKnowledgeEntries({})).toEqual([]);
  });

  it("answers a near-copy with the result the save itself would give", async () => {
    const saved = await call("save_knowledge_entry", ENTRY);
    const { id } = JSON.parse(saved.text) as { id: string };
    const again = await check("save_knowledge_entry", ENTRY);
    expect(again.isError).toBe(false);
    expect(JSON.parse(again.text)).toMatchObject({
      saved: false,
      possible_duplicates: [{ id }],
      next: expect.stringContaining("confirm_new"),
    });
    expect(
      await check("save_knowledge_entry", { ...ENTRY, confirm_new: true }),
    ).toEqual(WOULD_RUN);
  });

  it("says why an update would not apply", async () => {
    const saved = await call("save_knowledge_entry", OTHER_ENTRY);
    const { id } = JSON.parse(saved.text) as { id: string };
    const stale = await check("update_knowledge_entry", {
      id,
      resolution: "flush twice",
      expected_version: 7,
    });
    expect(stale.isError).toBe(true);
    expect(stale.text).toMatch(/version conflict/);
    expect(
      await check("update_knowledge_entry", { id, resolution: "flush twice" }),
    ).toEqual(WOULD_RUN);
  });

  it("refuses an input the tool's schema does not take", async () => {
    const untitled = await check("save_knowledge_entry", {
      product_slug: "tqx",
    });
    expect(untitled.isError).toBe(true);
    expect(untitled.text).toMatch(/title/);
  });

  it("has nothing to say of a tool with no check, or of no tool", async () => {
    expect(await check("search_knowledge", { query: "x" })).toEqual(WOULD_RUN);
    expect(await check("no_such_tool", {})).toEqual(WOULD_RUN);
  });
});
