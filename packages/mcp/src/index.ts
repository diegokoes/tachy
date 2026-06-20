import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  registerSource, resolveSource, ingestWorkItem, saveKnowledgeEntry, searchKnowledge,
} from "@casebook/core";
import { createFreshdeskSource } from "@casebook/source-freshdesk";

registerSource("freshdesk", createFreshdeskSource);

const server = new McpServer({ name: "casebook", version: "0.1.0" });

function out(obj: unknown) {
  return { content: [{ type: "text" as const, text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}

server.tool(
  "fetch_work_item",
  "Fetch a work item (ticket/issue) from a source, store it, and return its normalized metadata + cleaned messages for analysis.",
  { source: z.string(), external_id: z.string() },
  async ({ source, external_id }) => {
    const { conn, source: src } = await resolveSource(source);
    const raw = await src.fetchItem(external_id);
    const item = await ingestWorkItem(conn.id, raw);
    return out({ work_item_id: item.id, product_id: item.productId, team_id: item.teamId, item: raw });
  },
);

server.tool(
  "search_knowledge",
  "Search prior APPROVED knowledge entries by keyword / symptom / error code. Use for consult mode.",
  { query: z.string(), product_id: z.string().optional(), team_id: z.string().optional(), limit: z.number().optional() },
  async ({ query, product_id, team_id, limit }) => {
    const rows = await searchKnowledge(query, { productId: product_id, teamId: team_id, limit });
    return out(rows);
  },
);

server.tool(
  "get_context",
  "Fetch a new work item AND auto-search the archive for similar prior cases. One-shot consult helper.",
  { source: z.string(), external_id: z.string(), limit: z.number().optional() },
  async ({ source, external_id, limit }) => {
    const { conn, source: src } = await resolveSource(source);
    const raw = await src.fetchItem(external_id);
    await ingestWorkItem(conn.id, raw);
    const firstIncoming = raw.messages.find((m) => m.direction === "incoming")?.bodyText ?? "";
    const query = [raw.title, firstIncoming].filter(Boolean).join(" ");
    const similar = await searchKnowledge(query, { limit });
    return out({ work_item: raw, similar });
  },
);

server.tool(
  "save_knowledge_entry",
  "Persist an APPROVED structured knowledge entry. Call ONLY after the user reviewed and approved the summary.",
  {
    work_item_id: z.string().optional(),
    product_id: z.string().optional(),
    team_id: z.string().optional(),
    status: z.string().optional(),
    issue_summary: z.string().optional(),
    symptoms: z.array(z.string()).optional(),
    root_cause: z.string().optional(),
    resolution: z.string().optional(),
    resolution_pattern: z.string().optional(),
    product_area: z.string().optional(),
    confidence: z.string().optional(),
    structured: z.record(z.any()).optional(),
  },
  async (a) => {
    const row = await saveKnowledgeEntry({
      workItemId: a.work_item_id, productId: a.product_id, teamId: a.team_id,
      status: a.status ?? "approved", issueSummary: a.issue_summary, symptoms: a.symptoms,
      rootCause: a.root_cause, resolution: a.resolution, resolutionPattern: a.resolution_pattern,
      productArea: a.product_area, confidence: a.confidence, structured: a.structured,
    });
    return out({ saved: true, id: row.id, status: row.status });
  },
);

server.tool(
  "post_private_note",
  "Write a private note back to the source work item (e.g. a Freshdesk private note) with the learned analysis.",
  { source: z.string(), external_id: z.string(), body: z.string() },
  async ({ source, external_id, body }) => {
    const { source: src } = await resolveSource(source);
    if (!src.postNote) throw new Error(`Source '${source}' does not support notes`);
    await src.postNote(external_id, body, { private: true });
    return out({ posted: true });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
