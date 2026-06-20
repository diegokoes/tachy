import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  registerSource, resolveSource, ingestWorkItem, saveKnowledgeEntry, searchKnowledge,
  resolveCurrentUserId, addFeedback, recordRun,
} from "@tachy/core";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";

registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);

const server = new McpServer({ name: "tachy", version: "0.1.0" });

function out(obj: unknown) {
  return { content: [{ type: "text" as const, text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}

server.registerTool(
  "fetch_work_item",
  {
    description: "Fetch a work item (ticket/issue) from a source, store it, and return its normalized metadata + cleaned messages for analysis.",
    inputSchema: { source: z.string(), external_id: z.string() },
  },
  async ({ source, external_id }) => {
    const { conn, source: src } = await resolveSource(source);
    const raw = await src.fetchItem(external_id);
    const item = await ingestWorkItem(conn.id, raw);
    await recordRun({ workItemId: item.id, userId: await resolveCurrentUserId(), mode: "ingest" });
    return out({ work_item_id: item.id, product_id: item.productId, team_id: item.teamId, item: raw });
  },
);

server.registerTool(
  "search_knowledge",
  {
    description: "Search prior APPROVED knowledge entries by keyword / symptom / error code. Use for consult mode.",
    inputSchema: { query: z.string(), product_id: z.string().optional(), team_id: z.string().optional(), limit: z.number().optional() },
  },
  async ({ query, product_id, team_id, limit }) => {
    const rows = await searchKnowledge(query, { productId: product_id, teamId: team_id, limit });
    return out(rows);
  },
);

server.registerTool(
  "get_context",
  {
    description: "Fetch a new work item AND auto-search the archive for similar prior cases. One-shot consult helper.",
    inputSchema: { source: z.string(), external_id: z.string(), limit: z.number().optional() },
  },
  async ({ source, external_id, limit }) => {
    const { conn, source: src } = await resolveSource(source);
    const raw = await src.fetchItem(external_id);
    const item = await ingestWorkItem(conn.id, raw);
    await recordRun({ workItemId: item.id, userId: await resolveCurrentUserId(), mode: "consult" });
    const firstIncoming = raw.messages.find((m) => m.direction === "incoming")?.bodyText ?? "";
    const query = [raw.title, firstIncoming].filter(Boolean).join(" ");
    const similar = await searchKnowledge(query, { limit });
    return out({ work_item: raw, similar });
  },
);

server.registerTool(
  "save_knowledge_entry",
  {
    description: "Persist an APPROVED structured knowledge entry. Call ONLY after the user reviewed and approved the summary.",
    inputSchema: {
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
  },
  async (a) => {
    const row = await saveKnowledgeEntry({
      workItemId: a.work_item_id, productId: a.product_id, teamId: a.team_id,
      createdById: await resolveCurrentUserId(),
      status: a.status ?? "approved", issueSummary: a.issue_summary, symptoms: a.symptoms,
      rootCause: a.root_cause, resolution: a.resolution, resolutionPattern: a.resolution_pattern,
      productArea: a.product_area, confidence: a.confidence, structured: a.structured,
    });
    return out({ saved: true, id: row.id, status: row.status });
  },
);

server.registerTool(
  "post_private_note",
  {
    description: "Write a private note back to the source work item (e.g. a Freshdesk private note) with the learned analysis.",
    inputSchema: { source: z.string(), external_id: z.string(), body: z.string() },
  },
  async ({ source, external_id, body }) => {
    const { source: src } = await resolveSource(source);
    if (!src.postNote) throw new Error(`Source '${source}' does not support notes`);
    await src.postNote(external_id, body, { private: true });
    return out({ posted: true });
  },
);

server.registerTool(
  "add_knowledge_feedback",
  {
    description: "Record human feedback (a correction, rating, or note) on an existing knowledge entry, so it can be improved over time.",
    inputSchema: {
      knowledge_entry_id: z.string(),
      kind: z.enum(["correction", "rating", "note"]).optional(),
      rating: z.number().int().min(1).max(5).optional(),
      comment: z.string().optional(),
      patch: z.record(z.any()).optional(),
    },
  },
  async (a) => {
    const row = await addFeedback({
      knowledgeEntryId: a.knowledge_entry_id, userId: await resolveCurrentUserId(),
      kind: a.kind, rating: a.rating, comment: a.comment, patch: a.patch,
    });
    return out({ added: true, id: row.id, kind: row.kind });
  },
);

server.registerTool(
  "record_analysis_run",
  {
    description: "Report token usage for an ingest/consult analysis run, for audit and cost accounting. Pass the input/output tokens you used.",
    inputSchema: {
      mode: z.enum(["ingest", "consult", "sync"]),
      work_item_id: z.string().optional(),
      model: z.string().optional(),
      input_tokens: z.number().int().optional(),
      output_tokens: z.number().int().optional(),
      meta: z.record(z.any()).optional(),
    },
  },
  async (a) => {
    const row = await recordRun({
      mode: a.mode, workItemId: a.work_item_id, userId: await resolveCurrentUserId(),
      model: a.model, inputTokens: a.input_tokens, outputTokens: a.output_tokens, meta: a.meta,
    });
    return out({ recorded: true, id: row.id });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
