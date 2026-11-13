/**
 * The knowledge tools on the turn of someone who does not curate the entry's
 * team: the write becomes a proposal, and the result says so to the agent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createUser } from "@tachy/core/access";
import { CHECK_TOOL, env } from "@tachy/core/infra";
import {
  getKnowledgeEntry,
  saveKnowledgeEntry,
  searchKnowledge,
} from "@tachy/core/knowledge";
import { listFeedback } from "@tachy/core/knowledge";
import { getProposal, listMyProposals } from "@tachy/core/review";
import { server } from "../../packages/mcp/src/index";
import {
  resetData,
  seededFreshdeskConnId,
  sql,
  tqxProductId,
} from "../database";

afterAll(() => sql.end());

let client: Client;
let memberId = "";

type Answer = Record<string, unknown>;

async function call(name: string, args: Record<string, unknown>) {
  const answer = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  const text = answer.content[0]?.text ?? "";
  return {
    isError: answer.isError === true,
    text,
    json: (answer.isError ? {} : JSON.parse(text)) as Answer,
  };
}

beforeAll(async () => {
  await resetData();
  await createUser({ email: "root@example.com", role: "admin" });
  memberId = (await createUser({ email: "member@example.com" })).id;
  env.userEmail = "member@example.com";
  env.actor = "agent";

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(() => client.close());

describe("catalog tools without the right to them", () => {
  it("are refused by the dry run, before anyone is asked", async () => {
    const refused = await call(CHECK_TOOL, {
      tool: "add_customer",
      input: { name: "Dalmoor", slug: "dalmoor" },
    });
    expect(refused).toMatchObject({
      isError: true,
      text: "this action requires team admin or app admin rights",
    });
    const component = await call(CHECK_TOOL, {
      tool: "add_component",
      input: { product_slug: "tqx", slug: "renderer", name: "Renderer" },
    });
    expect(component.isError).toBe(true);
  });
});

describe("knowledge tools without curation rights", () => {
  it("stores a save as a draft for review and tells the agent it is not live", async () => {
    const saved = await call("save_knowledge_entry", {
      product_slug: "tqx",
      title: "Scanner drops off the network after sleep",
      issue_summary: "Handhelds lose their lease when they wake.",
      resolution: "pin the lease on the access point",
    });

    expect(saved.isError).toBe(false);
    expect(saved.json).toMatchObject({
      saved: true,
      proposed: true,
      status: "draft",
    });
    expect(String(saved.json.note)).toMatch(/Not live yet/);
    expect(await searchKnowledge("scanner drops off network")).toHaveLength(0);
    const [proposal] = await listMyProposals(memberId);
    expect(proposal).toMatchObject({ kind: "new", actor: "agent" });
  });

  it("holds an update as a proposal carrying its ticket and its reason", async () => {
    const entry = await saveKnowledgeEntry({
      productId: await tqxProductId(),
      title: "Label queue stalls after a spooler restart",
      resolution: "delete the lock file",
    });
    const [ticket] = await sql`
      insert into work_items (source_connection_id, external_id, title)
      values (${await seededFreshdeskConnId()}, '4711', 'queue stalled again')
      returning id
    `;

    const updated = await call("update_knowledge_entry", {
      id: entry.id,
      resolution: "delete spool.lock, then restart the spooler",
      work_item_id: ticket.id,
      reason: "the lock file is named on ticket 4711",
      expected_version: 1,
    });

    expect(updated.json).toMatchObject({ updated: false, proposed: true });
    expect((await getKnowledgeEntry(entry.id as string)).resolution).toBe(
      "delete the lock file",
    );
    const proposal = (await listMyProposals(memberId)).find(
      (p) => p.kind === "edit",
    )!;
    expect(await getProposal(proposal.id)).toMatchObject({
      patch: { resolution: "delete spool.lock, then restart the spooler" },
      work_item_id: ticket.id,
      note: "the lock file is named on ticket 4711",
      base_version: 1,
    });

    const read = await call("get_knowledge_entry", { id: entry.id });
    expect(read.json.tickets).toEqual([]);
  });

  it("takes feedback from anyone signed in", async () => {
    const entry = await saveKnowledgeEntry({
      productId: await tqxProductId(),
      title: "Invoice export is empty",
    });

    const feedback = await call("add_knowledge_feedback", {
      knowledge_entry_id: entry.id,
      kind: "rating",
      rating: 2,
      comment: "the cache was not the cause here",
    });

    expect(feedback.json).toMatchObject({ added: true, kind: "rating" });
    expect(await listFeedback(entry.id as string)).toHaveLength(1);
  });
});
