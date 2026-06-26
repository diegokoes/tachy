import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { ZodRawShape } from "zod";
import {
  registerSource, resolveSource, ingestWorkItem, saveKnowledgeEntry, searchKnowledge,
  updateKnowledgeEntry,
  resolveCurrentUserId, addFeedback, recordRun,
  listResolutionPatterns, addResolutionPattern,
  listComponents, addComponent, resolveComponentTags, getProductIdBySlug,
  listCustomers, addCustomer, getCustomerIdBySlug, setWorkItemCustomer, setObservedVersion, getCustomerName,
  listTeams, addTeam, listProducts, addProduct, listLabels, addLabel, getTeamIdBySlug,
  getKnowledgeEntry, listKnowledgeEntries,
  saveReferenceDoc, getReferenceDoc, listReferenceDocs, updateReferenceDoc, searchReferenceDocs,
  listSourceConnections, addSourceConnection, listSourceProductMaps, addSourceProductMap,
  AppError, log, cloudSchema, resolutionClaritySchema, learningValueSchema, badInput,
} from "@tachy/core";
import type { KnowledgeUpdateInput, ReferenceDocUpdate } from "@tachy/core";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";

registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);

const server = new McpServer({ name: "tachy", version: "0.1.0" });

function out(obj: unknown) {
  return { content: [{ type: "text" as const, text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}

type ToolConfig<I extends ZodRawShape> = {
  description?: string;
  inputSchema?: I;
  annotations?: Record<string, unknown>;
};

// Run a tool handler with timing, STDERR logging (one JSON line — stdout is the
// protocol stream), and conversion of any thrown error into a clean tool error
// (isError) instead of leaking a raw rejection. Exported so the envelope is
// directly testable without a live transport.
export async function runTool(
  name: string,
  cb: (args: unknown, extra: unknown) => unknown,
  args: unknown,
  extra: unknown,
) {
  const started = Date.now();
  try {
    const res = await cb(args, extra);
    log("info", "mcp_tool", { tool: name, ok: true, ms: Date.now() - started });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("error", "mcp_tool", {
      tool: name, ok: false, ms: Date.now() - started,
      ...(err instanceof AppError ? { code: err.code } : {}), error: message,
    });
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}

// Wrapper around server.registerTool that routes every call through runTool.
// Generic over the zod input shape so handlers keep full type inference.
function tool<I extends ZodRawShape>(name: string, config: ToolConfig<I>, cb: ToolCallback<I>): void {
  const wrapped = ((args: unknown, extra: unknown) =>
    runTool(name, cb as (a: unknown, e: unknown) => unknown, args, extra)) as ToolCallback<I>;
  server.registerTool(name, config as never, wrapped);
}

// Crude HTML → text for fetched URLs; good enough to hand the LLM readable context.
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Read-only: gather freeform context from pasted text, local files, and URLs.
async function loadContextSources(input: { text?: string; paths?: string[]; urls?: string[] }) {
  const sources: { source: string; text: string }[] = [];
  if (input.text?.trim()) sources.push({ source: "inline", text: input.text });
  for (const p of input.paths ?? []) {
    sources.push({ source: p, text: await readFile(p, "utf8") });
  }
  for (const u of input.urls ?? []) {
    const res = await fetch(u);
    if (!res.ok) throw new Error(`Failed to fetch ${u}: HTTP ${res.status}`);
    const raw = await res.text();
    const ct = res.headers.get("content-type") ?? "";
    sources.push({ source: u, text: ct.includes("html") ? stripHtml(raw) : raw });
  }
  return sources;
}

tool(
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
    const customerName = await getCustomerName(item.customerId);
    return out({
      work_item_id: item.id, product_id: item.productId, team_id: item.teamId,
      customer_id: item.customerId, customer_name: customerName, observed_version: item.observedVersion,
      item: raw,
    });
  },
);

tool(
  "search_knowledge",
  {
    description: "Search prior APPROVED knowledge entries by keyword / symptom / error code. Use for consult mode. Filter with product_slug / team_slug (slugs or aliases — not UUIDs), tags (entry must carry at least one), and/or component (resolved to the component's slug + aliases and matched against entry tags).",
    inputSchema: {
      query: z.string(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      tags: z.array(z.string()).optional(),
      component: z.string().optional(),
      limit: z.number().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, product_slug, team_slug, tags, component, limit }) => {
    const productId = product_slug ? await getProductIdBySlug(product_slug) : undefined;
    const teamId = team_slug ? await getTeamIdBySlug(team_slug) : undefined;
    const tagFilter = [...(tags ?? [])];
    if (component && productId) tagFilter.push(...(await resolveComponentTags(productId, component)));
    const rows = await searchKnowledge(query, {
      productId, teamId, tags: tagFilter.length ? tagFilter : undefined, limit,
    });
    return out(rows);
  },
);

tool(
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
    const productId = item.productId ?? undefined;
    const [similar, reference] = await Promise.all([
      searchKnowledge(query, { productId, limit }),
      searchReferenceDocs(query, { productId, limit }),
    ]);
    const customerName = await getCustomerName(item.customerId);
    return out({
      work_item: raw, similar, reference,
      customer_id: item.customerId, customer_name: customerName, observed_version: item.observedVersion,
    });
  },
);

tool(
  "save_knowledge_entry",
  {
    description: "Persist an APPROVED structured knowledge entry. Call ONLY after the user reviewed and approved the summary. resolution_pattern must be an existing slug from list_resolution_patterns (or omitted) — it is not free text.",
    inputSchema: {
      work_item_id: z.string().optional(),
      product_id: z.string().optional(),
      team_id: z.string().optional(),
      status: z.string().optional(),
      issue_summary: z.string().optional(),
      symptoms: z.array(z.string()).optional(),
      signals: z.array(z.string()).optional(),
      root_cause: z.string().optional(),
      resolution: z.string().optional(),
      resolution_pattern: z.string().optional(),
      product_area: z.string().optional(),
      confidence: z.string().optional(),
      tags: z.array(z.string()).optional(),
      cloud: cloudSchema.optional(),
      resolution_clarity: resolutionClaritySchema.optional(),
      learning_value: learningValueSchema.optional(),
      hidden_fix: z.boolean().optional(),
      structured: z.record(z.any()).optional(),
    },
  },
  async (a) => {
    const row = await saveKnowledgeEntry({
      workItemId: a.work_item_id, productId: a.product_id, teamId: a.team_id,
      createdById: await resolveCurrentUserId(),
      status: a.status ?? "approved", issueSummary: a.issue_summary, symptoms: a.symptoms, signals: a.signals,
      rootCause: a.root_cause, resolution: a.resolution, resolutionPattern: a.resolution_pattern,
      productArea: a.product_area, confidence: a.confidence, tags: a.tags,
      cloud: a.cloud, resolutionClarity: a.resolution_clarity, learningValue: a.learning_value, hiddenFix: a.hidden_fix,
      structured: a.structured,
    });
    return out({ saved: true, id: row.id, status: row.status });
  },
);

tool(
  "post_private_note",
  {
    description: "Write a private note back to the source work item (e.g. a Freshdesk private note) with the learned analysis.",
    inputSchema: { source: z.string(), external_id: z.string(), body: z.string() },
  },
  async ({ source, external_id, body }) => {
    const { source: src } = await resolveSource(source);
    if (!src.postNote) throw badInput(`Source '${source}' does not support notes`);
    await src.postNote(external_id, body, { private: true });
    return out({ posted: true, private: true, external_id, body });
  },
);

tool(
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

tool(
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

tool(
  "list_resolution_patterns",
  {
    description: "List the controlled vocabulary of resolution patterns. ALWAYS call this before choosing resolution_pattern for save_knowledge_entry — pick an existing slug, or leave it unset, rather than inventing one.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listResolutionPatterns()),
);

tool(
  "add_resolution_pattern",
  {
    description: "Add a new resolution_pattern slug to the controlled vocabulary. Call ONLY when the user explicitly asks to add a new pattern — never invent one just to tag a ticket; leave resolution_pattern unset instead.",
    inputSchema: { slug: z.string(), description: z.string() },
  },
  async ({ slug, description }) => out(await addResolutionPattern(slug, description)),
);

tool(
  "list_components",
  {
    description: "List the architecture glossary (components, hierarchical) for a product. Call this before reasoning about a ticket, so unfamiliar service/component names get checked against the real architecture instead of guessed at.",
    inputSchema: { product_slug: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ product_slug }) => out(await listComponents(await getProductIdBySlug(product_slug))),
);

tool(
  "add_component",
  {
    description: "Add (or update) a fact in the architecture glossary, e.g. a service, module, or config pool. Two valid call patterns: (1) the user is directly describing the app's architecture — call immediately; (2) a ticket mentions something not yet in the list — ASK the user first, call only after they confirm. Never silently invent components from a ticket. Use aliases for alternate names (e.g. slug 'line-controller' with aliases ['lc','LC']) so naming variants resolve to one component.",
    inputSchema: {
      product_slug: z.string(), slug: z.string(), name: z.string(),
      parent_slug: z.string().optional(), description: z.string().optional(),
      aliases: z.array(z.string()).optional(),
    },
  },
  async (a) => out(await addComponent({
    productId: await getProductIdBySlug(a.product_slug), slug: a.slug, name: a.name,
    parentSlug: a.parent_slug, description: a.description, aliases: a.aliases,
  })),
);

tool(
  "list_customers",
  {
    description: "List known customers, including aliases (other names / email domains resolving to the same account, e.g. a distributor). Use to check before correcting a work item's customer.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listCustomers()),
);

tool(
  "add_customer",
  {
    description: "Add (or extend) a customer, including aliases for distributors/resellers that front for the same account. Call when the user describes a customer or asks to add one — not inferred silently from a ticket.",
    inputSchema: {
      name: z.string(), slug: z.string(),
      aliases: z.array(z.string()).optional(), notes: z.string().optional(),
    },
  },
  async (a) => out(await addCustomer(a)),
);

tool(
  "set_work_item_customer",
  {
    description: "Correct (or clear) the customer auto-matched to a work item. Use when the auto-match is wrong or missing, e.g. a ticket routed through a distributor.",
    inputSchema: { work_item_id: z.string(), customer_slug: z.string().nullable() },
  },
  async ({ work_item_id, customer_slug }) => {
    const customerId = customer_slug ? await getCustomerIdBySlug(customer_slug) : null;
    await setWorkItemCustomer(work_item_id, customerId);
    return out({ updated: true, work_item_id, customer_id: customerId });
  },
);

tool(
  "set_observed_version",
  {
    description: "Record (or clear) the product version observed/mentioned on a specific ticket. Only set this when a version is actually known from the ticket — leave unset otherwise.",
    inputSchema: { work_item_id: z.string(), version: z.string().nullable() },
  },
  async ({ work_item_id, version }) => {
    await setObservedVersion(work_item_id, version);
    return out({ updated: true, work_item_id, observed_version: version });
  },
);

tool(
  "update_knowledge_entry",
  {
    description: "Update fields on an existing knowledge entry, or change its status (e.g. 'archived' to retire a stale lesson). Pass only the fields you want to change; omitted fields are left as-is. Nullable fields (issue_summary, root_cause, etc.) accept null to clear them. The search results include 'version' — pass it as expected_version to guard against concurrent edits.",
    inputSchema: {
      id: z.string(),
      status: z.enum(["draft", "approved", "rejected", "archived"]).optional(),
      issue_summary: z.string().nullable().optional(),
      root_cause: z.string().nullable().optional(),
      resolution: z.string().nullable().optional(),
      resolution_pattern: z.string().nullable().optional(),
      symptoms: z.array(z.string()).optional(),
      signals: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      product_area: z.string().nullable().optional(),
      confidence: z.enum(["low", "medium", "high"]).nullable().optional(),
      cloud: cloudSchema.nullable().optional(),
      resolution_clarity: resolutionClaritySchema.nullable().optional(),
      learning_value: learningValueSchema.nullable().optional(),
      hidden_fix: z.boolean().nullable().optional(),
      structured: z.record(z.any()).optional(),
      expected_version: z.number().int().optional(),
    },
  },
  async (a) => {
    const patch: KnowledgeUpdateInput = {};
    if (a.status            !== undefined) patch.status            = a.status;
    if (a.issue_summary     !== undefined) patch.issueSummary      = a.issue_summary;
    if (a.root_cause        !== undefined) patch.rootCause         = a.root_cause;
    if (a.resolution        !== undefined) patch.resolution        = a.resolution;
    if (a.resolution_pattern !== undefined) patch.resolutionPattern = a.resolution_pattern;
    if (a.symptoms          !== undefined) patch.symptoms          = a.symptoms;
    if (a.signals           !== undefined) patch.signals           = a.signals;
    if (a.tags              !== undefined) patch.tags              = a.tags;
    if (a.product_area      !== undefined) patch.productArea       = a.product_area;
    if (a.confidence        !== undefined) patch.confidence        = a.confidence;
    if (a.cloud             !== undefined) patch.cloud             = a.cloud;
    if (a.resolution_clarity !== undefined) patch.resolutionClarity = a.resolution_clarity;
    if (a.learning_value    !== undefined) patch.learningValue     = a.learning_value;
    if (a.hidden_fix        !== undefined) patch.hiddenFix         = a.hidden_fix;
    if (a.structured        !== undefined) patch.structured        = a.structured;
    if (a.expected_version  !== undefined) patch.expectedVersion   = a.expected_version;
    const row = await updateKnowledgeEntry(a.id, patch);
    return out({ updated: true, id: row.id, status: row.status, version: row.version });
  },
);

tool(
  "get_knowledge_entry",
  {
    description: "Fetch a single knowledge entry by id, including its current version and full structured field. Use before update_knowledge_entry / add_knowledge_feedback when you have an id but not the latest version.",
    inputSchema: { id: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ id }) => out(await getKnowledgeEntry(id)),
);

tool(
  "list_knowledge_entries",
  {
    description: "List knowledge entries (newest first), optionally filtered by status (e.g. 'draft' to find pending entries), product_slug / team_slug (slug or alias), or tags. Useful for review and curation — not semantic search; use search_knowledge for consult.",
    inputSchema: {
      status: z.enum(["draft", "approved", "rejected", "archived"]).optional(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ status, product_slug, team_slug, tags, limit }) => {
    const rows = await listKnowledgeEntries({
      status,
      productId: product_slug ? await getProductIdBySlug(product_slug) : undefined,
      teamId: team_slug ? await getTeamIdBySlug(team_slug) : undefined,
      tags: tags && tags.length ? tags : undefined,
      limit,
    });
    return out(rows);
  },
);

tool(
  "ingest_context",
  {
    description: "Load freeform project context from pasted text, local file paths, and/or URLs, and return the cleaned raw text for you to structure. This tool ONLY reads — it never saves. After loading, classify the content and route each part: durable incident lessons → save_knowledge_entry; architecture facts → add_component (ASK the user first); everything else (docs, runbooks, design notes, config explainers) → save_reference_doc. Always present a summary and get explicit user approval before any save.",
    inputSchema: {
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      text: z.string().optional(),
      paths: z.array(z.string()).optional(),
      urls: z.array(z.string()).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ product_slug, team_slug, text, paths, urls }) => {
    const sources = await loadContextSources({ text, paths, urls });
    if (!sources.length) throw badInput("Provide at least one of: text, paths, urls");
    return out({
      product_slug: product_slug ?? null,
      team_slug: team_slug ?? null,
      sources: sources.map((s) => ({ source: s.source, chars: s.text.length, text: s.text })),
      next: "Summarize, then propose knowledge_entries / reference_docs / components. Save only after the user approves.",
    });
  },
);

tool(
  "save_reference_doc",
  {
    description: "Persist an APPROVED reference doc — freeform project context (docs, runbooks, architecture notes) that doesn't fit the issue→root_cause→resolution shape of a knowledge entry. The body is chunked and embedded so it surfaces in consult-mode search. Call ONLY after the user approved the content.",
    inputSchema: {
      title: z.string(),
      body: z.string(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      source: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: z.enum(["draft", "approved", "archived"]).optional(),
      structured: z.record(z.any()).optional(),
    },
  },
  async (a) => {
    const row = await saveReferenceDoc({
      title: a.title, body: a.body,
      productId: a.product_slug ? await getProductIdBySlug(a.product_slug) : undefined,
      teamId: a.team_slug ? await getTeamIdBySlug(a.team_slug) : undefined,
      createdById: await resolveCurrentUserId(),
      source: a.source, tags: a.tags, status: a.status ?? "approved", structured: a.structured,
    });
    return out({ saved: true, id: row.id, status: row.status, chunks: row.chunks });
  },
);

tool(
  "search_reference",
  {
    description: "Semantic search over approved reference docs (project context). Returns the best-matching snippet per doc. Filter by product_slug / team_slug (slug or alias) and tags.",
    inputSchema: {
      query: z.string(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, product_slug, team_slug, tags, limit }) => out(await searchReferenceDocs(query, {
    productId: product_slug ? await getProductIdBySlug(product_slug) : undefined,
    teamId: team_slug ? await getTeamIdBySlug(team_slug) : undefined,
    tags: tags && tags.length ? tags : undefined, limit,
  })),
);

tool(
  "list_reference_docs",
  {
    description: "List reference docs (newest first), optionally filtered by status, product_slug / team_slug, or tags. Bodies are omitted; use get_reference_doc for the full text.",
    inputSchema: {
      status: z.enum(["draft", "approved", "archived"]).optional(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ status, product_slug, team_slug, tags, limit }) => out(await listReferenceDocs({
    status,
    productId: product_slug ? await getProductIdBySlug(product_slug) : undefined,
    teamId: team_slug ? await getTeamIdBySlug(team_slug) : undefined,
    tags: tags && tags.length ? tags : undefined, limit,
  })),
);

tool(
  "get_reference_doc",
  {
    description: "Fetch a single reference doc by id, including its full body and current version.",
    inputSchema: { id: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ id }) => out(await getReferenceDoc(id)),
);

tool(
  "update_reference_doc",
  {
    description: "Update a reference doc, or change its status ('archived' to retire). Pass only the fields you want to change. If the body changes it is re-chunked and re-embedded. Pass expected_version (from list/get) to guard against concurrent edits.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      body: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: z.enum(["draft", "approved", "archived"]).optional(),
      source: z.string().nullable().optional(),
      structured: z.record(z.any()).optional(),
      expected_version: z.number().int().optional(),
    },
  },
  async (a) => {
    const patch: ReferenceDocUpdate = {};
    if (a.title           !== undefined) patch.title           = a.title;
    if (a.body            !== undefined) patch.body            = a.body;
    if (a.tags            !== undefined) patch.tags            = a.tags;
    if (a.status          !== undefined) patch.status          = a.status;
    if (a.source          !== undefined) patch.source          = a.source;
    if (a.structured      !== undefined) patch.structured      = a.structured;
    if (a.expected_version !== undefined) patch.expectedVersion = a.expected_version;
    const row = await updateReferenceDoc(a.id, patch);
    return out({ updated: true, id: row.id, status: row.status, version: row.version });
  },
);

tool(
  "list_teams",
  {
    description: "List all teams. Call this to discover team slugs before calling add_product, list_products, or search_knowledge with a team filter.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listTeams()),
);

tool(
  "add_team",
  {
    description: "Add (or rename) a team. The slug is a short kebab-case identifier used by all other tools.",
    inputSchema: { slug: z.string(), name: z.string() },
  },
  async ({ slug, name }) => out(await addTeam(slug, name)),
);

tool(
  "list_products",
  {
    description: "List all products, optionally filtered by team slug. Call this to discover product slugs before calling list_components, search_knowledge with a product filter, or add_source_product_map.",
    inputSchema: { team_slug: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ team_slug }) => out(await listProducts(team_slug)),
);

tool(
  "add_product",
  {
    description: "Add (or rename) a product under a team. The slug is used by components, knowledge search, and source mappings. Use aliases for alternate names (e.g. slug 'tpd' with aliases ['Tobacco Product Directive']) so they all resolve to this product.",
    inputSchema: { team_slug: z.string(), slug: z.string(), name: z.string(), aliases: z.array(z.string()).optional() },
  },
  async ({ team_slug, slug, name, aliases }) => out(await addProduct(team_slug, slug, name, aliases)),
);

tool(
  "list_labels",
  {
    description: "List the optional, per-product advisory tag vocabulary. Call this before tagging a knowledge entry so you reuse existing tag slugs (e.g. 'lc', 'mas', 'printing') instead of inventing near-duplicates. An empty list is normal — tags are free-form, this is just a curated suggestion list.",
    inputSchema: { product_slug: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ product_slug }) => out(await listLabels(await getProductIdBySlug(product_slug))),
);

tool(
  "add_label",
  {
    description: "Add a tag slug to a product's advisory label vocabulary. Call when the user wants to curate the team's taxonomy — not inferred silently. Tags on knowledge entries remain free-form; this only records a preferred vocabulary.",
    inputSchema: { product_slug: z.string(), slug: z.string(), description: z.string().optional() },
  },
  async ({ product_slug, slug, description }) => out(await addLabel(await getProductIdBySlug(product_slug), slug, description)),
);

tool(
  "list_source_connections",
  {
    description: "List all configured source connections (Freshdesk tenants, GitHub orgs, etc.).",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listSourceConnections()),
);

tool(
  "add_source_connection",
  {
    description: "Register a new source connection. source_type is 'freshdesk' or 'github'. slug is a short unique identifier (e.g. 'my-freshdesk') — it also determines the env var for the API token: FRESHDESK_TOKEN_<SLUG_UPPERCASED> or GITHUB_TOKEN_<SLUG_UPPERCASED> (non-alphanumerics become underscores). For Freshdesk: set base_url to your tenant root URL (e.g. https://your-domain.freshdesk.com). For GitHub: omit base_url and set config to {\"repos\":[\"owner/repo\"]}. The token is never stored in the DB; remind the user to set the env var before syncing.",
    inputSchema: {
      source_type: z.enum(["freshdesk", "github"]),
      slug: z.string(),
      base_url: z.string().optional(),
      config: z.record(z.any()).optional(),
    },
  },
  async (a) => out(await addSourceConnection({ sourceType: a.source_type, slug: a.slug, baseUrl: a.base_url, config: a.config })),
);

tool(
  "list_source_product_maps",
  {
    description: "List group→product mappings for one or all source connections. For Freshdesk the external_group_key is the numeric group_id (as text); for GitHub it is 'owner/repo'.",
    inputSchema: { source_slug: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ source_slug }) => out(await listSourceProductMaps(source_slug)),
);

tool(
  "add_source_product_map",
  {
    description: "Map a source-native grouping to an internal product. For Freshdesk: external_group_key is the group_id (find it in Freshdesk Admin > Groups, or from a fetched ticket's raw payload). For GitHub: external_group_key is 'owner/repo'. Call list_source_connections and list_products first to get the right slugs.",
    inputSchema: {
      source_slug: z.string(),
      external_group_key: z.string(),
      product_slug: z.string(),
    },
  },
  async (a) => out(await addSourceProductMap({ sourceSlug: a.source_slug, externalGroupKey: a.external_group_key, productSlug: a.product_slug })),
);

export { server };

// Only attach the stdio transport when run as the entrypoint, so importing this
// module in tests doesn't hijack stdin/stdout.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
