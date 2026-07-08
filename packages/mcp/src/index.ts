import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { ZodRawShape } from "zod";
import {
  registerSource, resolveSource, ingestWorkItem, saveKnowledgeEntry, searchKnowledge,
  updateKnowledgeEntry,
  resolveCurrentUserId, addFeedback, recordRun, sql, countAdmins, forbidden,
  canManageTeam, assertCanEditScope, assertAnyTeamAdmin, assertGlobalAdmin,
  listResolutionPatterns, addResolutionPattern,
  listComponents, addComponent, resolveComponentFilter, getProductIdBySlug,
  listCustomers, addCustomer, getCustomerIdBySlug, setWorkItemCustomer, setObservedVersion, getCustomerName, getCustomerSlug,
  resolveRedactionPolicy, redactForLlm, globalRedactionEnabled, scrubDeep, scrubText, TokenMap, loadSettingsIntoEnv,
  listTeams, addTeam, listProducts, addProduct, listLabels, addLabel, getTeamIdBySlug,
  getKnowledgeEntry, listKnowledgeEntries, listEnvironments,
  saveReferenceDoc, getReferenceDoc, listReferenceDocs, updateReferenceDoc, searchReferenceDocs,
  listSourceConnections, addSourceConnection, listSourceProductMaps, addSourceProductMap,
  AppError, log, cloudSchema, resolutionClaritySchema, learningValueSchema, badInput,
  knowledgeStatusSchema, referenceStatusSchema, confidenceSchema, feedbackKindSchema, runModeSchema,
} from "@tachy/core";
import type { EntryScope, KnowledgeUpdateInput, ReferenceDocUpdate } from "@tachy/core";
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

// Retrieved archive content (knowledge entries, reference docs) can carry PII
// saved before redaction was enabled; these tools have no source connection, so
// the deployment-wide TACHY_REDACT flag is their only policy source.
function outScrubbed(obj: unknown) {
  return out(globalRedactionEnabled() ? scrubDeep(obj, new TokenMap()) : obj);
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

// ── Write authorization ──────────────────────────────────────────────────────
// The same team-scoped permission model the HTTP API enforces, applied to the
// write tools. Two deliberate open paths: TACHY_USER_EMAIL unset = a trusted
// local stdio caller (CLI/dev  the web agent always injects the session
// email), and a not-yet-bootstrapped instance (no admin exists). A positive
// bootstrap check is cached for the process lifetime, like the API does.
let enforcementCache = false;
async function enforcementActive(): Promise<boolean> {
  if (enforcementCache) return true;
  enforcementCache = (await countAdmins()) > 0;
  return enforcementCache;
}

// The user id writes must be authorized against, or null when unenforced.
async function gateUserId(): Promise<string | null> {
  const userId = await resolveCurrentUserId();
  if (!userId) return null;
  return (await enforcementActive()) ? userId : null;
}

async function requireCanEdit(scope: EntryScope): Promise<void> {
  const userId = await gateUserId();
  if (userId) await assertCanEditScope(userId, scope);
}

async function requireCanManageTeam(teamId: string | null | undefined): Promise<void> {
  const userId = await gateUserId();
  if (!userId) return;
  if (!teamId || !(await canManageTeam(userId, teamId)))
    throw forbidden("you don't have admin rights for this team");
}

async function requireAnyTeamAdmin(): Promise<void> {
  const userId = await gateUserId();
  if (userId) await assertAnyTeamAdmin(userId);
}

async function requireGlobalAdmin(): Promise<void> {
  const userId = await gateUserId();
  if (userId) await assertGlobalAdmin(userId);
}

// Scope of the target row, for authorizing updates.
async function knowledgeEntryScope(id: string): Promise<EntryScope> {
  const [row] = await sql`select product_id, team_id from knowledge_entries where id = ${id}`;
  return row ? { productId: row.product_id, teamId: row.team_id } : {};
}

async function referenceDocScope(id: string): Promise<EntryScope> {
  const [row] = await sql`select product_id, team_id from reference_docs where id = ${id}`;
  return row ? { productId: row.product_id, teamId: row.team_id } : {};
}

// Scope a new entry/doc will land in; a work-item-only save inherits the
// item's product/team (mirrors saveKnowledgeEntry).
async function newEntryScope(i: { productId?: string | null; teamId?: string | null; workItemId?: string | null }): Promise<EntryScope> {
  if (i.productId || i.teamId) return { productId: i.productId, teamId: i.teamId };
  if (i.workItemId) {
    const [wi] = await sql`select product_id, team_id from work_items where id = ${i.workItemId}`;
    if (wi) return { productId: wi.product_id, teamId: wi.team_id };
  }
  return {};
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
    // Redact PII from the LLM-facing copy only, AFTER storage + customer matching.
    const forLlm = resolveRedactionPolicy(conn.config).enabled
      ? redactForLlm(raw, src.redactRaw, await getCustomerSlug(item.customerId))
      : raw;
    return out({
      work_item_id: item.id, product_id: item.productId, team_id: item.teamId,
      customer_id: item.customerId, customer_name: customerName, observed_version: item.observedVersion,
      item: forLlm,
    });
  },
);

tool(
  "search_knowledge",
  {
    description: "Search prior knowledge entries by keyword / symptom / error code. Use for consult mode. Results may include status 'deprecated' entries (possibly with superseded_by pointing at their replacement) — warn that those are outdated, never present them as current advice. Filter with product_slug / team_slug (slugs or aliases — not UUIDs), tags (entry must carry at least one), and/or component (matches the entry's linked component or its slug/aliases in tags).",
    inputSchema: {
      query: z.string(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      tags: z.array(z.string()).optional(),
      component: z.string().optional(),
      affected_version: z.string().optional(),
      fixed_version: z.string().optional(),
      limit: z.number().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, product_slug, team_slug, tags, component, affected_version, fixed_version, limit }) => {
    const productId = product_slug ? await getProductIdBySlug(product_slug) : undefined;
    const teamId = team_slug ? await getTeamIdBySlug(team_slug) : undefined;
    const tagFilter = [...(tags ?? [])];
    let componentId: string | undefined;
    let componentTags: string[] | undefined;
    if (component && productId) {
      const f = await resolveComponentFilter(productId, component);
      componentId = f.componentId;
      componentTags = f.componentTags;
      if (f.extraTags) tagFilter.push(...f.extraTags);
    }
    const rows = await searchKnowledge(query, {
      productId, teamId, tags: tagFilter.length ? tagFilter : undefined,
      componentId, componentTags,
      affectedVersion: affected_version, fixedVersion: fixed_version, limit,
    });
    return outScrubbed(rows);
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
    // Build the archive-search query from the un-redacted item (stays server-side).
    const firstIncoming = raw.messages.find((m) => m.direction === "incoming")?.bodyText ?? "";
    const query = [raw.title, firstIncoming].filter(Boolean).join(" ");
    const productId = item.productId ?? undefined;
    const [similar, reference] = await Promise.all([
      searchKnowledge(query, { productId, limit }),
      searchReferenceDocs(query, { productId, limit }),
    ]);
    const customerName = await getCustomerName(item.customerId);
    // Redact the LLM-facing work item AND the retrieved archive content — prior
    // entries/docs may carry PII saved before redaction was enabled.
    const redact = resolveRedactionPolicy(conn.config).enabled;
    const forLlm = redact
      ? redactForLlm(raw, src.redactRaw, await getCustomerSlug(item.customerId))
      : raw;
    const retrievalMap = new TokenMap();
    return out({
      work_item: forLlm,
      similar: redact ? scrubDeep(similar, retrievalMap) : similar,
      reference: redact ? scrubDeep(reference, retrievalMap) : reference,
      customer_id: item.customerId, customer_name: customerName, observed_version: item.observedVersion,
    });
  },
);

tool(
  "save_knowledge_entry",
  {
    description: "Persist an APPROVED structured knowledge entry. Call ONLY after the user reviewed and approved the summary. resolution_pattern must be an existing slug from list_resolution_patterns (or omitted) — it is not free text. component must be an existing slug/alias from list_components; if the ticket's area is missing from the glossary, propose add_component in the same review step and call it after user approval, then save. product_area is derived automatically from the component hierarchy — it is not an input. For manual entries (no work_item_id) that set component, pass product_slug — component slugs resolve within a product.",
    inputSchema: {
      work_item_id: z.string().optional(),
      product_slug: z.string().optional().describe("Product slug or alias — the normal way to scope an entry. Required for manual entries that set component."),
      team_slug: z.string().optional().describe("Team slug or alias."),
      product_id: z.string().optional().describe("Product UUID — only if you already hold one (e.g. from fetch_work_item); otherwise use product_slug."),
      team_id: z.string().optional().describe("Team UUID — otherwise use team_slug."),
      status: knowledgeStatusSchema.optional(),
      issue_summary: z.string().optional(),
      symptoms: z.array(z.string()).optional(),
      signals: z.array(z.string()).optional(),
      root_cause: z.string().optional(),
      resolution: z.string().optional(),
      resolution_pattern: z.string().optional(),
      component: z.string().optional(),
      confidence: confidenceSchema.optional(),
      tags: z.array(z.string()).optional(),
      cloud: cloudSchema.optional().describe("Environment the issue was observed in — lowercase slug (e.g. prod, qa, dev). Call list_environments first and reuse an existing value when one fits."),
      resolution_clarity: resolutionClaritySchema.optional(),
      learning_value: learningValueSchema.optional(),
      hidden_fix: z.boolean().optional(),
      affected_version: z.string().optional().describe("Product version the issue was observed in. When omitted, seeds automatically from the work item's observed_version."),
      fixed_version: z.string().optional().describe("Product version the fix landed in  only when actually known."),
      structured: z.record(z.string(), z.any()).optional(),
    },
  },
  async (a) => {
    const productId = a.product_id ?? (a.product_slug ? await getProductIdBySlug(a.product_slug) : undefined);
    const teamId = a.team_id ?? (a.team_slug ? await getTeamIdBySlug(a.team_slug) : undefined);
    await requireCanEdit(await newEntryScope({ productId, teamId, workItemId: a.work_item_id }));
    const row = await saveKnowledgeEntry({
      workItemId: a.work_item_id,
      productId,
      teamId,
      createdById: await resolveCurrentUserId(),
      status: a.status ?? "approved", issueSummary: a.issue_summary, symptoms: a.symptoms, signals: a.signals,
      rootCause: a.root_cause, resolution: a.resolution, resolutionPattern: a.resolution_pattern,
      component: a.component, confidence: a.confidence, tags: a.tags,
      cloud: a.cloud, resolutionClarity: a.resolution_clarity, learningValue: a.learning_value, hiddenFix: a.hidden_fix,
      affectedVersion: a.affected_version, fixedVersion: a.fixed_version,
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
    description: "Record human feedback (a correction, rating, or note) on an existing knowledge entry, so it can be improved over time. kind 'deprecation' records WHY an entry is outdated — the actual retirement is a separate update_knowledge_entry call with status 'deprecated' after user confirmation.",
    inputSchema: {
      knowledge_entry_id: z.string(),
      kind: feedbackKindSchema.optional(),
      rating: z.number().int().min(1).max(5).optional(),
      comment: z.string().optional(),
      patch: z.record(z.string(), z.any()).optional(),
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
      mode: runModeSchema,
      work_item_id: z.string().optional(),
      model: z.string().optional(),
      input_tokens: z.number().int().optional(),
      output_tokens: z.number().int().optional(),
      meta: z.record(z.string(), z.any()).optional(),
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
  "list_environments",
  {
    description: "List the environments ('cloud' values) already used by knowledge entries in this deployment, with usage counts. The vocabulary is deployment-specific (e.g. prod/qa vs dev/demo/preprod) — call this before setting `cloud` on a save/update and reuse an existing slug when one fits, rather than inventing a near-duplicate.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listEnvironments()),
);

tool(
  "add_resolution_pattern",
  {
    description: "Add a new resolution_pattern slug to the controlled vocabulary. Call ONLY when the user explicitly asks to add a new pattern — never invent one just to tag a ticket; leave resolution_pattern unset instead.",
    inputSchema: { slug: z.string(), description: z.string() },
  },
  async ({ slug, description }) => {
    await requireAnyTeamAdmin();
    return out(await addResolutionPattern(slug, description));
  },
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
  async (a) => {
    const productId = await getProductIdBySlug(a.product_slug);
    await requireCanEdit({ productId });
    return out(await addComponent({
      productId, slug: a.slug, name: a.name,
      parentSlug: a.parent_slug, description: a.description, aliases: a.aliases,
    }));
  },
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
  async (a) => {
    await requireAnyTeamAdmin();
    return out(await addCustomer(a));
  },
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
    description: "Update fields on an existing knowledge entry, or change its status. Mark outdated knowledge with status 'deprecated' (it stays searchable but flagged; set superseded_by when a newer entry replaces it) — reserve 'archived' for entries that should vanish from search entirely. Pass only the fields you want to change; omitted fields are left as-is. Nullable fields (issue_summary, root_cause, etc.) accept null to clear them. component takes a slug/alias from list_components (product_area is re-derived from it; null clears both). The search results include 'version' — pass it as expected_version to guard against concurrent edits.",
    inputSchema: {
      id: z.string(),
      status: knowledgeStatusSchema.optional(),
      issue_summary: z.string().nullable().optional(),
      root_cause: z.string().nullable().optional(),
      resolution: z.string().nullable().optional(),
      resolution_pattern: z.string().nullable().optional(),
      symptoms: z.array(z.string()).optional(),
      signals: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      component: z.string().nullable().optional(),
      superseded_by: z.string().nullable().optional(),
      confidence: confidenceSchema.nullable().optional(),
      cloud: cloudSchema.nullable().optional().describe("Environment slug — reuse an existing value from list_environments when one fits; null clears it."),
      resolution_clarity: resolutionClaritySchema.nullable().optional(),
      learning_value: learningValueSchema.nullable().optional(),
      hidden_fix: z.boolean().nullable().optional(),
      affected_version: z.string().nullable().optional().describe("Product version the issue was observed in; null clears it."),
      fixed_version: z.string().nullable().optional().describe("Product version the fix landed in; null clears it."),
      structured: z.record(z.string(), z.any()).optional(),
      expected_version: z.number().int().optional(),
    },
  },
  async (a) => {
    await requireCanEdit(await knowledgeEntryScope(a.id));
    const patch: KnowledgeUpdateInput = {};
    if (a.status            !== undefined) patch.status            = a.status;
    if (a.issue_summary     !== undefined) patch.issueSummary      = a.issue_summary;
    if (a.root_cause        !== undefined) patch.rootCause         = a.root_cause;
    if (a.resolution        !== undefined) patch.resolution        = a.resolution;
    if (a.resolution_pattern !== undefined) patch.resolutionPattern = a.resolution_pattern;
    if (a.symptoms          !== undefined) patch.symptoms          = a.symptoms;
    if (a.signals           !== undefined) patch.signals           = a.signals;
    if (a.tags              !== undefined) patch.tags              = a.tags;
    if (a.component         !== undefined) patch.component         = a.component;
    if (a.superseded_by     !== undefined) patch.supersededBy      = a.superseded_by;
    if (a.confidence        !== undefined) patch.confidence        = a.confidence;
    if (a.cloud             !== undefined) patch.cloud             = a.cloud;
    if (a.resolution_clarity !== undefined) patch.resolutionClarity = a.resolution_clarity;
    if (a.learning_value    !== undefined) patch.learningValue     = a.learning_value;
    if (a.hidden_fix        !== undefined) patch.hiddenFix         = a.hidden_fix;
    if (a.affected_version  !== undefined) patch.affectedVersion   = a.affected_version;
    if (a.fixed_version     !== undefined) patch.fixedVersion      = a.fixed_version;
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
  async ({ id }) => outScrubbed(await getKnowledgeEntry(id)),
);

tool(
  "list_knowledge_entries",
  {
    description: "List knowledge entries (newest first), optionally filtered by status (e.g. 'draft' to find pending entries, 'deprecated' to review outdated ones), product_slug / team_slug (slug or alias), or tags. Useful for review and curation — not semantic search; use search_knowledge for consult.",
    inputSchema: {
      status: knowledgeStatusSchema.optional(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      tags: z.array(z.string()).optional(),
      component: z.string().optional().describe("Component slug/alias  matches the entry's linked component or its slug/aliases in tags. Needs product_slug."),
      affected_version: z.string().optional(),
      fixed_version: z.string().optional(),
      limit: z.number().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ status, product_slug, team_slug, tags, component, affected_version, fixed_version, limit }) => {
    const productId = product_slug ? await getProductIdBySlug(product_slug) : undefined;
    const tagFilter = [...(tags ?? [])];
    let componentId: string | undefined;
    let componentTags: string[] | undefined;
    if (component && productId) {
      const f = await resolveComponentFilter(productId, component);
      componentId = f.componentId;
      componentTags = f.componentTags;
      if (f.extraTags) tagFilter.push(...f.extraTags);
    }
    const rows = await listKnowledgeEntries({
      status,
      productId,
      teamId: team_slug ? await getTeamIdBySlug(team_slug) : undefined,
      tags: tagFilter.length ? tagFilter : undefined,
      componentId, componentTags,
      affectedVersion: affected_version,
      fixedVersion: fixed_version,
      limit,
    });
    return outScrubbed(rows);
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
    // No source connection here, so the deployment-wide flag decides. Pattern
    // scrub only — freeform context declares no requester/author names to match.
    const redact = globalRedactionEnabled();
    const map = new TokenMap();
    return out({
      product_slug: product_slug ?? null,
      team_slug: team_slug ?? null,
      sources: sources.map((s) => ({
        source: s.source, chars: s.text.length,
        text: redact ? scrubText(s.text, map) : s.text,
      })),
      ...(redact ? { redaction: "Placeholders like [EMAIL_1]/[SECRET_1] are intentional redactions — treat them as opaque, never guess the originals." } : {}),
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
      status: referenceStatusSchema.optional(),
      structured: z.record(z.string(), z.any()).optional(),
    },
  },
  async (a) => {
    const productId = a.product_slug ? await getProductIdBySlug(a.product_slug) : undefined;
    const teamId = a.team_slug ? await getTeamIdBySlug(a.team_slug) : undefined;
    await requireCanEdit({ productId, teamId });
    const row = await saveReferenceDoc({
      title: a.title, body: a.body,
      productId,
      teamId,
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
  async ({ query, product_slug, team_slug, tags, limit }) => outScrubbed(await searchReferenceDocs(query, {
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
      status: referenceStatusSchema.optional(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ status, product_slug, team_slug, tags, limit }) => outScrubbed(await listReferenceDocs({
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
  async ({ id }) => outScrubbed(await getReferenceDoc(id)),
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
      status: referenceStatusSchema.optional(),
      source: z.string().nullable().optional(),
      structured: z.record(z.string(), z.any()).optional(),
      expected_version: z.number().int().optional(),
    },
  },
  async (a) => {
    await requireCanEdit(await referenceDocScope(a.id));
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
  async ({ slug, name }) => {
    await requireGlobalAdmin();
    return out(await addTeam(slug, name));
  },
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
  async ({ team_slug, slug, name, aliases }) => {
    await requireCanManageTeam(await getTeamIdBySlug(team_slug));
    return out(await addProduct(team_slug, slug, name, aliases));
  },
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
  async ({ product_slug, slug, description }) => {
    const productId = await getProductIdBySlug(product_slug);
    await requireCanEdit({ productId });
    return out(await addLabel(productId, slug, description));
  },
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
      config: z.record(z.string(), z.any()).optional(),
    },
  },
  async (a) => {
    await requireGlobalAdmin();
    return out(await addSourceConnection({ sourceType: a.source_type, slug: a.slug, baseUrl: a.base_url, config: a.config }));
  },
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
  async (a) => {
    await requireGlobalAdmin();
    return out(await addSourceProductMap({ sourceSlug: a.source_slug, externalGroupKey: a.external_group_key, productSlug: a.product_slug }));
  },
);

export { server };

// Only attach the stdio transport when run as the entrypoint, so importing this
// module in tests doesn't hijack stdin/stdout.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  // DB-backed settings (e.g. the redaction switch) are materialized into env
  // once at boot — the redaction check reads process.env synchronously.
  // Best-effort: the settings table may not exist on not-yet-migrated DBs.
  try {
    await loadSettingsIntoEnv();
  } catch {
    /* keep env-only behavior */
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
