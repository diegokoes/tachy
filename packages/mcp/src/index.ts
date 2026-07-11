import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { ZodRawShape } from "zod";
import {
  registerSource,
  resolveSource,
  ingestWorkItem,
  saveKnowledgeEntry,
  searchKnowledge,
  updateKnowledgeEntry,
  resolveCurrentUserId,
  addFeedback,
  recordRun,
  sql,
  countAdmins,
  forbidden,
  canManageTeam,
  assertCanEditScope,
  assertAnyTeamAdmin,
  assertGlobalAdmin,
  listResolutionPatterns,
  addResolutionPattern,
  listComponents,
  addComponent,
  resolveComponentFilter,
  getProductIdBySlug,
  listCustomers,
  addCustomer,
  getCustomerIdBySlug,
  setWorkItemCustomer,
  setObservedVersion,
  getCustomerName,
  getCustomerSlug,
  resolveRedactionPolicy,
  redactForLlm,
  extractAdoRefs,
  listRepos,
  searchCode,
  readCodeFile,
  globalRedactionEnabled,
  scrubDeep,
  scrubText,
  TokenMap,
  loadSettingsIntoEnv,
  listTeams,
  addTeam,
  listProducts,
  addProduct,
  listLabels,
  addLabel,
  getTeamIdBySlug,
  getKnowledgeEntry,
  listKnowledgeEntries,
  listEnvironments,
  saveReferenceDoc,
  getReferenceDoc,
  listReferenceDocs,
  updateReferenceDoc,
  searchReferenceDocs,
  referenceDocLineage,
  listSourceConnections,
  addSourceConnection,
  listSourceProductMaps,
  addSourceProductMap,
  AppError,
  log,
  cloudSchema,
  resolutionClaritySchema,
  learningValueSchema,
  badInput,
  knowledgeStatusSchema,
  referenceStatusSchema,
  confidenceSchema,
  feedbackKindSchema,
  runModeSchema,
} from "@tachy/core";
import type {
  EntryScope,
  KnowledgeUpdateInput,
  ReferenceDocUpdate,
} from "@tachy/core";
import { pathToFileURL } from "node:url";
import { extractSource } from "./extract";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";
import {
  createAzureDevopsSource,
  createAdoClient,
} from "@tachy/source-azure-devops";
import type { AdoClient, JsonPatchOp } from "@tachy/source-azure-devops";

registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);
registerSource("azure-devops", createAzureDevopsSource);

const server = new McpServer({ name: "tachy", version: "0.1.0" });

function out(obj: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2),
      },
    ],
  };
}

function outScrubbed(obj: unknown) {
  return out(globalRedactionEnabled() ? scrubDeep(obj, new TokenMap()) : obj);
}

async function resolveScopeIds(opts: {
  product_slug?: string;
  team_slug?: string;
}): Promise<{ productId?: string; teamId?: string }> {
  return {
    productId: opts.product_slug
      ? await getProductIdBySlug(opts.product_slug)
      : undefined,
    teamId: opts.team_slug ? await getTeamIdBySlug(opts.team_slug) : undefined,
  };
}

async function componentIntoFilter(
  productId: string | undefined,
  component: string | undefined,
  tags: string[] | undefined,
): Promise<{
  tags?: string[];
  componentId?: string;
  componentTags?: string[];
}> {
  const tagFilter = [...(tags ?? [])];
  let componentId: string | undefined;
  let componentTags: string[] | undefined;
  if (component && productId) {
    const f = await resolveComponentFilter(productId, component);
    componentId = f.componentId;
    componentTags = f.componentTags;
    if (f.extraTags) tagFilter.push(...f.extraTags);
  }
  return {
    tags: tagFilter.length ? tagFilter : undefined,
    componentId,
    componentTags,
  };
}

type ToolConfig<I extends ZodRawShape> = {
  description?: string;
  inputSchema?: I;
  annotations?: Record<string, unknown>;
};

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
      tool: name,
      ok: false,
      ms: Date.now() - started,
      ...(err instanceof AppError ? { code: err.code } : {}),
      error: message,
    });
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    };
  }
}

function tool<I extends ZodRawShape>(
  name: string,
  config: ToolConfig<I>,
  cb: ToolCallback<I>,
): void {
  const wrapped = ((args: unknown, extra: unknown) =>
    runTool(
      name,
      cb as (a: unknown, e: unknown) => unknown,
      args,
      extra,
    )) as ToolCallback<I>;
  server.registerTool(name, config as never, wrapped);
}

let enforcementCache = false;
async function enforcementActive(): Promise<boolean> {
  if (enforcementCache) return true;
  enforcementCache = (await countAdmins()) > 0;
  return enforcementCache;
}

async function gateUserId(): Promise<string | null> {
  const userId = await resolveCurrentUserId();
  if (!userId) return null;
  return (await enforcementActive()) ? userId : null;
}

async function requireCanEdit(scope: EntryScope): Promise<void> {
  const userId = await gateUserId();
  if (userId) await assertCanEditScope(userId, scope);
}

async function requireCanManageTeam(
  teamId: string | null | undefined,
): Promise<void> {
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

async function knowledgeEntryScope(id: string): Promise<EntryScope> {
  const [row] =
    await sql`select product_id, team_id from knowledge_entries where id = ${id}`;
  return row ? { productId: row.product_id, teamId: row.team_id } : {};
}

async function referenceDocScope(id: string): Promise<EntryScope> {
  const [row] =
    await sql`select product_id, team_id from reference_docs where id = ${id}`;
  return row ? { productId: row.product_id, teamId: row.team_id } : {};
}

async function newEntryScope(i: {
  productId?: string | null;
  teamId?: string | null;
  workItemId?: string | null;
}): Promise<EntryScope> {
  if (i.productId || i.teamId)
    return { productId: i.productId, teamId: i.teamId };
  if (i.workItemId) {
    const [wi] =
      await sql`select product_id, team_id from work_items where id = ${i.workItemId}`;
    if (wi) return { productId: wi.product_id, teamId: wi.team_id };
  }
  return {};
}

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

async function loadContextSources(input: {
  text?: string;
  paths?: string[];
  urls?: string[];
}) {
  const sources: { source: string; text: string; pages?: number }[] = [];
  if (input.text?.trim()) sources.push({ source: "inline", text: input.text });
  for (const p of input.paths ?? []) {
    const { text, pages } = await extractSource(p);
    sources.push({ source: p, text, ...(pages != null ? { pages } : {}) });
  }
  for (const u of input.urls ?? []) {
    const res = await fetch(u);
    if (!res.ok) throw badInput(`Failed to fetch ${u}: HTTP ${res.status}`);
    const raw = await res.text();
    const ct = res.headers.get("content-type") ?? "";
    sources.push({
      source: u,
      text: ct.includes("html") ? stripHtml(raw) : raw,
    });
  }
  return sources;
}

tool(
  "fetch_work_item",
  {
    description:
      "Fetch a work item (ticket/issue) from a source, store it, and return its normalized metadata + cleaned messages for analysis.",
    inputSchema: { source: z.string(), external_id: z.string() },
  },
  async ({ source, external_id }) => {
    const { conn, source: src } = await resolveSource(source);
    const raw = await src.fetchItem(external_id);
    const item = await ingestWorkItem(conn.id, raw);
    await recordRun({
      workItemId: item.id,
      userId: await resolveCurrentUserId(),
      mode: "ingest",
    });
    const customerName = await getCustomerName(item.customerId);

    const forLlm = resolveRedactionPolicy(conn.config).enabled
      ? redactForLlm(raw, src.redactRaw, await getCustomerSlug(item.customerId))
      : raw;
    const adoRefs = extractAdoRefs(raw);
    return out({
      work_item_id: item.id,
      product_id: item.productId,
      team_id: item.teamId,
      customer_id: item.customerId,
      customer_name: customerName,
      observed_version: item.observedVersion,
      item: forLlm,
      ...(adoRefs.length
        ? {
            linked_ado_refs: adoRefs,
            next: "linked_ado_refs are Azure DevOps work item ids referenced by this item. If an azure-devops source connection exists (list_source_connections), you may fetch them with fetch_work_item for extra context — their relations come back as summaries already; do not fetch relations of relations.",
          }
        : {}),
    });
  },
);

tool(
  "search_knowledge",
  {
    description:
      "Search prior knowledge entries by keyword / symptom / error code. Use for consult mode. Results may include status 'deprecated' entries (possibly with superseded_by pointing at their replacement) — warn that those are outdated, never present them as current advice. Filter with product_slug / team_slug (slugs or aliases — not UUIDs), tags (entry must carry at least one), and/or component (matches the entry's linked component or its slug/aliases in tags).",
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
  async ({
    query,
    product_slug,
    team_slug,
    tags,
    component,
    affected_version,
    fixed_version,
    limit,
  }) => {
    const { productId, teamId } = await resolveScopeIds({
      product_slug,
      team_slug,
    });
    const rows = await searchKnowledge(query, {
      productId,
      teamId,
      includeUnscoped: true,
      ...(await componentIntoFilter(productId, component, tags)),
      affectedVersion: affected_version,
      fixedVersion: fixed_version,
      limit,
    });
    return outScrubbed(rows);
  },
);

tool(
  "get_context",
  {
    description:
      "Fetch a new work item AND auto-search the archive for similar prior cases. One-shot consult helper.",
    inputSchema: {
      source: z.string(),
      external_id: z.string(),
      limit: z.number().optional(),
    },
  },
  async ({ source, external_id, limit }) => {
    const { conn, source: src } = await resolveSource(source);
    const raw = await src.fetchItem(external_id);
    const item = await ingestWorkItem(conn.id, raw);
    await recordRun({
      workItemId: item.id,
      userId: await resolveCurrentUserId(),
      mode: "consult",
    });

    const firstIncoming =
      raw.messages.find((m) => m.direction === "incoming")?.bodyText ?? "";
    const query = [raw.title, firstIncoming].filter(Boolean).join(" ");
    const productId = item.productId ?? undefined;
    const [similar, reference] = await Promise.all([
      searchKnowledge(query, { productId, limit, includeUnscoped: true }),
      searchReferenceDocs(query, { productId, limit, includeUnscoped: true }),
    ]);
    const customerName = await getCustomerName(item.customerId);

    const redact = resolveRedactionPolicy(conn.config).enabled;
    const forLlm = redact
      ? redactForLlm(raw, src.redactRaw, await getCustomerSlug(item.customerId))
      : raw;
    const retrievalMap = new TokenMap();
    const adoRefs = extractAdoRefs(raw);
    return out({
      work_item: forLlm,
      similar: redact ? scrubDeep(similar, retrievalMap) : similar,
      reference: redact ? scrubDeep(reference, retrievalMap) : reference,
      customer_id: item.customerId,
      customer_name: customerName,
      observed_version: item.observedVersion,
      ...(adoRefs.length
        ? {
            linked_ado_refs: adoRefs,
            next: "linked_ado_refs are Azure DevOps work item ids referenced by this item. If an azure-devops source connection exists (list_source_connections), you may fetch them with fetch_work_item for extra context — their relations come back as summaries already; do not fetch relations of relations.",
          }
        : {}),
    });
  },
);

tool(
  "save_knowledge_entry",
  {
    description:
      "Persist an APPROVED structured knowledge entry. Call ONLY after the user reviewed and approved the summary. resolution_pattern must be an existing slug from list_resolution_patterns (or omitted) — it is not free text. component must be an existing slug/alias from list_components; if the ticket's area is missing from the glossary, propose add_component in the same review step and call it after user approval, then save. product_area is derived automatically from the component hierarchy — it is not an input. For manual entries (no work_item_id) that set component, pass product_slug — component slugs resolve within a product.",
    inputSchema: {
      work_item_id: z.string().optional(),
      product_slug: z
        .string()
        .optional()
        .describe(
          "Product slug or alias — the normal way to scope an entry. Required for manual entries that set component.",
        ),
      team_slug: z.string().optional().describe("Team slug or alias."),
      product_id: z
        .string()
        .optional()
        .describe(
          "Product UUID — only if you already hold one (e.g. from fetch_work_item); otherwise use product_slug.",
        ),
      team_id: z
        .string()
        .optional()
        .describe("Team UUID — otherwise use team_slug."),
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
      cloud: cloudSchema
        .optional()
        .describe(
          "Environment the issue was observed in — lowercase slug (e.g. prod, qa, dev). Call list_environments first and reuse an existing value when one fits.",
        ),
      resolution_clarity: resolutionClaritySchema.optional(),
      learning_value: learningValueSchema.optional(),
      hidden_fix: z.boolean().optional(),
      affected_version: z
        .string()
        .optional()
        .describe(
          "Product version the issue was observed in. When omitted, seeds automatically from the work item's observed_version.",
        ),
      fixed_version: z
        .string()
        .optional()
        .describe(
          "Product version the fix landed in  only when actually known.",
        ),
      structured: z.record(z.string(), z.any()).optional(),
    },
  },
  async (a) => {
    const resolved = await resolveScopeIds(a);
    const productId = a.product_id ?? resolved.productId;
    const teamId = a.team_id ?? resolved.teamId;
    await requireCanEdit(
      await newEntryScope({ productId, teamId, workItemId: a.work_item_id }),
    );
    const row = await saveKnowledgeEntry({
      workItemId: a.work_item_id,
      productId,
      teamId,
      createdById: await resolveCurrentUserId(),
      status: a.status ?? "approved",
      issueSummary: a.issue_summary,
      symptoms: a.symptoms,
      signals: a.signals,
      rootCause: a.root_cause,
      resolution: a.resolution,
      resolutionPattern: a.resolution_pattern,
      component: a.component,
      confidence: a.confidence,
      tags: a.tags,
      cloud: a.cloud,
      resolutionClarity: a.resolution_clarity,
      learningValue: a.learning_value,
      hiddenFix: a.hidden_fix,
      affectedVersion: a.affected_version,
      fixedVersion: a.fixed_version,
      structured: a.structured,
    });
    return out({ saved: true, id: row.id, status: row.status });
  },
);

tool(
  "post_private_note",
  {
    description:
      "Write a private note back to the source work item (e.g. a Freshdesk private note) with the learned analysis.",
    inputSchema: {
      source: z.string(),
      external_id: z.string(),
      body: z.string(),
    },
  },
  async ({ source, external_id, body }) => {
    const { source: src } = await resolveSource(source);
    if (!src.postNote)
      throw badInput(`Source '${source}' does not support notes`);
    await src.postNote(external_id, body, { private: true });
    return out({ posted: true, private: true, external_id, body });
  },
);

tool(
  "add_knowledge_feedback",
  {
    description:
      "Record human feedback (a correction, rating, or note) on an existing knowledge entry, so it can be improved over time. kind 'deprecation' records WHY an entry is outdated — the actual retirement is a separate update_knowledge_entry call with status 'deprecated' after user confirmation.",
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
      knowledgeEntryId: a.knowledge_entry_id,
      userId: await resolveCurrentUserId(),
      kind: a.kind,
      rating: a.rating,
      comment: a.comment,
      patch: a.patch,
    });
    return out({ added: true, id: row.id, kind: row.kind });
  },
);

tool(
  "record_analysis_run",
  {
    description:
      "Report token usage for an ingest/consult analysis run, for audit and cost accounting. Pass the input/output tokens you used.",
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
      mode: a.mode,
      workItemId: a.work_item_id,
      userId: await resolveCurrentUserId(),
      model: a.model,
      inputTokens: a.input_tokens,
      outputTokens: a.output_tokens,
      meta: a.meta,
    });
    return out({ recorded: true, id: row.id });
  },
);

tool(
  "list_resolution_patterns",
  {
    description:
      "List the controlled vocabulary of resolution patterns. ALWAYS call this before choosing resolution_pattern for save_knowledge_entry — pick an existing slug, or leave it unset, rather than inventing one.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listResolutionPatterns()),
);

tool(
  "list_environments",
  {
    description:
      "List the environments ('cloud' values) already used by knowledge entries in this deployment, with usage counts. The vocabulary is deployment-specific (e.g. prod/qa vs dev/demo/preprod) — call this before setting `cloud` on a save/update and reuse an existing slug when one fits, rather than inventing a near-duplicate.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listEnvironments()),
);

tool(
  "add_resolution_pattern",
  {
    description:
      "Add a new resolution_pattern slug to the controlled vocabulary. Call ONLY when the user explicitly asks to add a new pattern — never invent one just to tag a ticket; leave resolution_pattern unset instead.",
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
    description:
      "List the architecture glossary (components, hierarchical) for a product. Call this before reasoning about a ticket, so unfamiliar service/component names get checked against the real architecture instead of guessed at.",
    inputSchema: { product_slug: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ product_slug }) =>
    out(await listComponents(await getProductIdBySlug(product_slug))),
);

tool(
  "add_component",
  {
    description:
      "Add (or update) a fact in the architecture glossary, e.g. a service, module, or config pool. Two valid call patterns: (1) the user is directly describing the app's architecture — call immediately; (2) a ticket mentions something not yet in the list — ASK the user first, call only after they confirm. Never silently invent components from a ticket. Use aliases for alternate names (e.g. slug 'line-controller' with aliases ['lc','LC']) so naming variants resolve to one component.",
    inputSchema: {
      product_slug: z.string(),
      slug: z.string(),
      name: z.string(),
      parent_slug: z.string().optional(),
      description: z.string().optional(),
      aliases: z.array(z.string()).optional(),
    },
  },
  async (a) => {
    const productId = await getProductIdBySlug(a.product_slug);
    await requireCanEdit({ productId });
    return out(
      await addComponent({
        productId,
        slug: a.slug,
        name: a.name,
        parentSlug: a.parent_slug,
        description: a.description,
        aliases: a.aliases,
      }),
    );
  },
);

tool(
  "list_customers",
  {
    description:
      "List known customers, including aliases (other names / email domains resolving to the same account, e.g. a distributor). Use to check before correcting a work item's customer.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listCustomers()),
);

tool(
  "add_customer",
  {
    description:
      "Add (or extend) a customer, including aliases for distributors/resellers that front for the same account. Call when the user describes a customer or asks to add one — not inferred silently from a ticket.",
    inputSchema: {
      name: z.string(),
      slug: z.string(),
      aliases: z.array(z.string()).optional(),
      notes: z.string().optional(),
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
    description:
      "Correct (or clear) the customer auto-matched to a work item. Use when the auto-match is wrong or missing, e.g. a ticket routed through a distributor.",
    inputSchema: {
      work_item_id: z.string(),
      customer_slug: z.string().nullable(),
    },
  },
  async ({ work_item_id, customer_slug }) => {
    const customerId = customer_slug
      ? await getCustomerIdBySlug(customer_slug)
      : null;
    await setWorkItemCustomer(work_item_id, customerId);
    return out({ updated: true, work_item_id, customer_id: customerId });
  },
);

tool(
  "set_observed_version",
  {
    description:
      "Record (or clear) the product version observed/mentioned on a specific ticket. Only set this when a version is actually known from the ticket — leave unset otherwise.",
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
    description:
      "Update fields on an existing knowledge entry, or change its status. Mark outdated knowledge with status 'deprecated' (it stays searchable but flagged; set superseded_by when a newer entry replaces it) — reserve 'archived' for entries that should vanish from search entirely. Pass only the fields you want to change; omitted fields are left as-is. Nullable fields (issue_summary, root_cause, etc.) accept null to clear them. component takes a slug/alias from list_components (product_area is re-derived from it; null clears both). The search results include 'version' — pass it as expected_version to guard against concurrent edits.",
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
      cloud: cloudSchema
        .nullable()
        .optional()
        .describe(
          "Environment slug — reuse an existing value from list_environments when one fits; null clears it.",
        ),
      resolution_clarity: resolutionClaritySchema.nullable().optional(),
      learning_value: learningValueSchema.nullable().optional(),
      hidden_fix: z.boolean().nullable().optional(),
      affected_version: z
        .string()
        .nullable()
        .optional()
        .describe("Product version the issue was observed in; null clears it."),
      fixed_version: z
        .string()
        .nullable()
        .optional()
        .describe("Product version the fix landed in; null clears it."),
      structured: z.record(z.string(), z.any()).optional(),
      expected_version: z.number().int().optional(),
    },
  },
  async (a) => {
    await requireCanEdit(await knowledgeEntryScope(a.id));
    const patch: KnowledgeUpdateInput = {};
    if (a.status !== undefined) patch.status = a.status;
    if (a.issue_summary !== undefined) patch.issueSummary = a.issue_summary;
    if (a.root_cause !== undefined) patch.rootCause = a.root_cause;
    if (a.resolution !== undefined) patch.resolution = a.resolution;
    if (a.resolution_pattern !== undefined)
      patch.resolutionPattern = a.resolution_pattern;
    if (a.symptoms !== undefined) patch.symptoms = a.symptoms;
    if (a.signals !== undefined) patch.signals = a.signals;
    if (a.tags !== undefined) patch.tags = a.tags;
    if (a.component !== undefined) patch.component = a.component;
    if (a.superseded_by !== undefined) patch.supersededBy = a.superseded_by;
    if (a.confidence !== undefined) patch.confidence = a.confidence;
    if (a.cloud !== undefined) patch.cloud = a.cloud;
    if (a.resolution_clarity !== undefined)
      patch.resolutionClarity = a.resolution_clarity;
    if (a.learning_value !== undefined) patch.learningValue = a.learning_value;
    if (a.hidden_fix !== undefined) patch.hiddenFix = a.hidden_fix;
    if (a.affected_version !== undefined)
      patch.affectedVersion = a.affected_version;
    if (a.fixed_version !== undefined) patch.fixedVersion = a.fixed_version;
    if (a.structured !== undefined) patch.structured = a.structured;
    if (a.expected_version !== undefined)
      patch.expectedVersion = a.expected_version;
    const row = await updateKnowledgeEntry(a.id, patch);
    return out({
      updated: true,
      id: row.id,
      status: row.status,
      version: row.version,
    });
  },
);

tool(
  "get_knowledge_entry",
  {
    description:
      "Fetch a single knowledge entry by id, including its current version and full structured field. Use before update_knowledge_entry / add_knowledge_feedback when you have an id but not the latest version.",
    inputSchema: { id: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ id }) => outScrubbed(await getKnowledgeEntry(id)),
);

tool(
  "list_knowledge_entries",
  {
    description:
      "List knowledge entries (newest first), optionally filtered by status (e.g. 'draft' to find pending entries, 'deprecated' to review outdated ones), product_slug / team_slug (slug or alias), or tags. Useful for review and curation — not semantic search; use search_knowledge for consult.",
    inputSchema: {
      status: knowledgeStatusSchema.optional(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      tags: z.array(z.string()).optional(),
      component: z
        .string()
        .optional()
        .describe(
          "Component slug/alias  matches the entry's linked component or its slug/aliases in tags. Needs product_slug.",
        ),
      affected_version: z.string().optional(),
      fixed_version: z.string().optional(),
      limit: z.number().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({
    status,
    product_slug,
    team_slug,
    tags,
    component,
    affected_version,
    fixed_version,
    limit,
  }) => {
    const { productId, teamId } = await resolveScopeIds({
      product_slug,
      team_slug,
    });
    const rows = await listKnowledgeEntries({
      status,
      productId,
      teamId,
      ...(await componentIntoFilter(productId, component, tags)),
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
    description:
      "Load freeform project context from pasted text, local file paths, and/or URLs, and return the cleaned raw text for you to structure. PDF paths are text-extracted automatically. This tool ONLY reads — it never saves. Long sources are truncated at max_chars (default 20000); for large documents (big PDFs), preview here, then after user approval call save_reference_doc with body_path so the full text is extracted and saved server-side. After loading, classify the content and route each part: durable incident lessons → save_knowledge_entry; architecture facts → add_component (ASK the user first); everything else (docs, runbooks, design notes, config explainers) → save_reference_doc. Always present a summary and get explicit user approval before any save.",
    inputSchema: {
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      text: z.string().optional(),
      paths: z.array(z.string()).optional(),
      urls: z.array(z.string()).optional(),
      max_chars: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ product_slug, team_slug, text, paths, urls, max_chars }) => {
    const sources = await loadContextSources({ text, paths, urls });
    if (!sources.length)
      throw badInput("Provide at least one of: text, paths, urls");

    const limit = max_chars ?? 20_000;
    const redact = globalRedactionEnabled();
    const map = new TokenMap();
    return out({
      product_slug: product_slug ?? null,
      team_slug: team_slug ?? null,
      sources: sources.map((s) => {
        const truncated = s.text.length > limit;
        const textOut = truncated ? s.text.slice(0, limit) : s.text;
        return {
          source: s.source,
          chars: s.text.length,
          ...(s.pages != null ? { pages: s.pages } : {}),
          truncated,
          text: redact ? scrubText(textOut, map) : textOut,
          ...(truncated
            ? {
                note: `Truncated at ${limit} of ${s.text.length} chars — summarize from this preview; to save the FULL text as a reference doc, call save_reference_doc with body_path after user approval.`,
              }
            : {}),
        };
      }),
      ...(redact
        ? {
            redaction:
              "Placeholders like [EMAIL_1]/[SECRET_1] are intentional redactions — treat them as opaque, never guess the originals.",
          }
        : {}),
      next: "Summarize, then propose knowledge_entries / reference_docs / components. Save only after the user approves.",
    });
  },
);

tool(
  "save_reference_doc",
  {
    description:
      "Persist an APPROVED reference doc — freeform project context (docs, runbooks, architecture notes) that doesn't fit the issue→root_cause→resolution shape of a knowledge entry. The body is chunked and embedded so it surfaces in consult-mode search. Provide EITHER body (inline text) OR body_path (a local file — e.g. a large PDF — extracted server-side so the full text is saved without echoing it). Pass doc_version when the source document carries a version label; pass supersedes with the id of the doc this replaces — the predecessor is archived and linked automatically, and search returns only the latest version. Call ONLY after the user approved the content.",
    inputSchema: {
      title: z.string(),
      body: z.string().optional(),
      body_path: z.string().optional(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      source: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: referenceStatusSchema.optional(),
      structured: z.record(z.string(), z.any()).optional(),
      doc_version: z.string().optional(),
      supersedes: z.string().optional(),
    },
  },
  async (a) => {
    if (!a.body === !a.body_path)
      throw badInput("Provide exactly one of body or body_path");
    const { productId, teamId } = await resolveScopeIds(a);
    if (productId || teamId || !a.supersedes)
      await requireCanEdit({ productId, teamId });
    else await requireCanEdit(await referenceDocScope(a.supersedes));

    let body = a.body;
    let pages: number | undefined;
    if (a.body_path) {
      const extracted = await extractSource(a.body_path);
      body = globalRedactionEnabled()
        ? scrubText(extracted.text, new TokenMap())
        : extracted.text;
      pages = extracted.pages;
    }
    const row = await saveReferenceDoc({
      title: a.title,
      body: body!,
      productId,
      teamId,
      createdById: await resolveCurrentUserId(),
      source: a.source,
      tags: a.tags,
      status: a.status ?? "approved",
      structured: a.structured,
      docVersion: a.doc_version,
      supersedes: a.supersedes,
    });
    return out({
      saved: true,
      id: row.id,
      status: row.status,
      chunks: row.chunks,
      body_chars: body!.length,
      ...(pages != null ? { pages } : {}),
    });
  },
);

tool(
  "search_reference",
  {
    description:
      "Semantic search over approved reference docs (project context). Returns the best-matching snippet per doc. Filter by product_slug / team_slug (slug or alias) and tags.",
    inputSchema: {
      query: z.string(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, product_slug, team_slug, tags, limit }) =>
    outScrubbed(
      await searchReferenceDocs(query, {
        ...(await resolveScopeIds({ product_slug, team_slug })),
        includeUnscoped: true,
        tags: tags && tags.length ? tags : undefined,
        limit,
      }),
    ),
);

tool(
  "list_reference_docs",
  {
    description:
      "List reference docs (newest first), optionally filtered by status, product_slug / team_slug, or tags. Bodies are omitted; use get_reference_doc for the full text. Rows carry doc_version and superseded_by — archived rows with superseded_by set are old versions of a newer doc.",
    inputSchema: {
      status: referenceStatusSchema.optional(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ status, product_slug, team_slug, tags, limit }) =>
    outScrubbed(
      await listReferenceDocs({
        status,
        ...(await resolveScopeIds({ product_slug, team_slug })),
        tags: tags && tags.length ? tags : undefined,
        limit,
      }),
    ),
);

tool(
  "get_reference_doc",
  {
    description:
      "Fetch a single reference doc by id, including its full body, doc_version, and lineage (all versions of this doc, newest first).",
    inputSchema: { id: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ id }) =>
    outScrubbed({
      ...(await getReferenceDoc(id)),
      lineage: await referenceDocLineage(id),
    }),
);

tool(
  "update_reference_doc",
  {
    description:
      "Update a reference doc, or change its status ('archived' to retire). Pass only the fields you want to change. If the body changes it is re-chunked and re-embedded. To publish a NEW VERSION of a doc, do not edit the body here — call save_reference_doc with supersedes instead. Pass expected_version (from list/get) to guard against concurrent edits.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      body: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: referenceStatusSchema.optional(),
      source: z.string().nullable().optional(),
      structured: z.record(z.string(), z.any()).optional(),
      doc_version: z.string().nullable().optional(),
      expected_version: z.number().int().optional(),
    },
  },
  async (a) => {
    await requireCanEdit(await referenceDocScope(a.id));
    const patch: ReferenceDocUpdate = {};
    if (a.title !== undefined) patch.title = a.title;
    if (a.body !== undefined) patch.body = a.body;
    if (a.tags !== undefined) patch.tags = a.tags;
    if (a.status !== undefined) patch.status = a.status;
    if (a.source !== undefined) patch.source = a.source;
    if (a.structured !== undefined) patch.structured = a.structured;
    if (a.doc_version !== undefined) patch.docVersion = a.doc_version;
    if (a.expected_version !== undefined)
      patch.expectedVersion = a.expected_version;
    const row = await updateReferenceDoc(a.id, patch);
    return out({
      updated: true,
      id: row.id,
      status: row.status,
      version: row.version,
    });
  },
);

tool(
  "list_teams",
  {
    description:
      "List all teams. Call this to discover team slugs before calling add_product, list_products, or search_knowledge with a team filter.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listTeams()),
);

tool(
  "add_team",
  {
    description:
      "Add (or rename) a team. The slug is a short kebab-case identifier used by all other tools.",
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
    description:
      "List all products, optionally filtered by team slug. Call this to discover product slugs before calling list_components, search_knowledge with a product filter, or add_source_product_map.",
    inputSchema: { team_slug: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ team_slug }) => out(await listProducts(team_slug)),
);

tool(
  "add_product",
  {
    description:
      "Add (or rename) a product under a team. The slug is used by components, knowledge search, and source mappings. Use aliases for alternate names (e.g. slug 'tpd' with aliases ['Tobacco Product Directive']) so they all resolve to this product.",
    inputSchema: {
      team_slug: z.string(),
      slug: z.string(),
      name: z.string(),
      aliases: z.array(z.string()).optional(),
    },
  },
  async ({ team_slug, slug, name, aliases }) => {
    await requireCanManageTeam(await getTeamIdBySlug(team_slug));
    return out(await addProduct(team_slug, slug, name, aliases));
  },
);

tool(
  "list_labels",
  {
    description:
      "List the optional, per-product advisory tag vocabulary. Call this before tagging a knowledge entry so you reuse existing tag slugs (e.g. 'lc', 'mas', 'printing') instead of inventing near-duplicates. An empty list is normal — tags are free-form, this is just a curated suggestion list.",
    inputSchema: { product_slug: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ product_slug }) =>
    out(await listLabels(await getProductIdBySlug(product_slug))),
);

tool(
  "add_label",
  {
    description:
      "Add a tag slug to a product's advisory label vocabulary. Call when the user wants to curate the team's taxonomy — not inferred silently. Tags on knowledge entries remain free-form; this only records a preferred vocabulary.",
    inputSchema: {
      product_slug: z.string(),
      slug: z.string(),
      description: z.string().optional(),
    },
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
    description:
      "List all configured source connections (Freshdesk tenants, GitHub orgs, etc.).",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listSourceConnections()),
);

tool(
  "add_source_connection",
  {
    description:
      "Register a new source connection. source_type is 'freshdesk', 'github', or 'azure-devops'. slug is a short unique identifier (e.g. 'my-freshdesk') — it also determines the env var for the API token: FRESHDESK_TOKEN_<SLUG_UPPERCASED>, GITHUB_TOKEN_<SLUG_UPPERCASED>, or AZURE_DEVOPS_TOKEN_<SLUG_UPPERCASED> (non-alphanumerics become underscores). For Freshdesk: set base_url to your tenant root URL (e.g. https://your-domain.freshdesk.com). For GitHub: omit base_url and set config to {\"repos\":[\"owner/repo\"]}. For Azure DevOps: base_url is the org URL (https://dev.azure.com/<org>), config is {\"projects\":[\"ProjectA\",\"ProjectB\"]}, and the token is a PAT (scopes: Work Items Read, plus Read & Write for ticket creation, Wiki Read for wikis, Code Read for repos). Tokens are never stored in the DB — set the env var, or store per-user/team via the credentials vault.",
    inputSchema: {
      source_type: z.enum(["freshdesk", "github", "azure-devops"]),
      slug: z.string(),
      base_url: z.string().optional(),
      config: z.record(z.string(), z.any()).optional(),
    },
  },
  async (a) => {
    await requireGlobalAdmin();
    return out(
      await addSourceConnection({
        sourceType: a.source_type,
        slug: a.slug,
        baseUrl: a.base_url,
        config: a.config,
      }),
    );
  },
);

tool(
  "list_source_product_maps",
  {
    description:
      "List group→product mappings for one or all source connections. For Freshdesk the external_group_key is the numeric group_id (as text); for GitHub it is 'owner/repo'.",
    inputSchema: { source_slug: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ source_slug }) => out(await listSourceProductMaps(source_slug)),
);

tool(
  "add_source_product_map",
  {
    description:
      "Map a source-native grouping to an internal product. For Freshdesk: external_group_key is the group_id (find it in Freshdesk Admin > Groups, or from a fetched ticket's raw payload). For GitHub: external_group_key is 'owner/repo'. For Azure DevOps: external_group_key is the project name (the fetched item's groupKey). Call list_source_connections and list_products first to get the right slugs.",
    inputSchema: {
      source_slug: z.string(),
      external_group_key: z.string(),
      product_slug: z.string(),
    },
  },
  async (a) => {
    await requireGlobalAdmin();
    return out(
      await addSourceProductMap({
        sourceSlug: a.source_slug,
        externalGroupKey: a.external_group_key,
        productSlug: a.product_slug,
      }),
    );
  },
);

async function resolveAdoClient(
  sourceSlug: string,
): Promise<{ conn: Awaited<ReturnType<typeof resolveSource>>["conn"]; client: AdoClient }> {
  const { conn } = await resolveSource(sourceSlug);
  if (conn.sourceType !== "azure-devops")
    throw badInput(
      `Source '${sourceSlug}' is type '${conn.sourceType}' — this tool needs an azure-devops connection (see list_source_connections)`,
    );
  return {
    conn,
    client: createAdoClient({
      baseUrl: conn.baseUrl ?? "",
      slug: conn.slug,
      config: conn.config,
    }),
  };
}

tool(
  "list_ado_wikis",
  {
    description:
      "List the Azure DevOps wikis in a project (or across the org when project is omitted). source must be an azure-devops connection slug.",
    inputSchema: { source: z.string(), project: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ source, project }) => {
    const { client } = await resolveAdoClient(source);
    const wikis = await client.listWikis(project);
    return out(
      wikis.map((w: any) => ({
        id: w.id,
        name: w.name,
        type: w.type,
        project: w.projectId ?? project ?? null,
      })),
    );
  },
);

tool(
  "list_ado_wiki_pages",
  {
    description:
      "List page paths of an Azure DevOps wiki (flattened page tree). Use get_ado_wiki_page to fetch a page's content.",
    inputSchema: {
      source: z.string(),
      project: z.string(),
      wiki: z.string().describe("Wiki name or id from list_ado_wikis"),
      path_prefix: z.string().optional(),
      limit: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ source, project, wiki, path_prefix, limit }) => {
    const { client } = await resolveAdoClient(source);
    let paths = await client.listWikiPages(project, wiki);
    if (path_prefix) paths = paths.filter((p) => p.startsWith(path_prefix));
    const max = limit ?? 100;
    return out({
      total: paths.length,
      truncated: paths.length > max,
      pages: paths.slice(0, max),
    });
  },
);

tool(
  "get_ado_wiki_page",
  {
    description:
      "Fetch one Azure DevOps wiki page's markdown content. READ ONLY — it never saves. To persist the knowledge, classify it (incident lesson → save_knowledge_entry; freeform doc/runbook → save_reference_doc with source set to the page URL) and save only after explicit user approval.",
    inputSchema: {
      source: z.string(),
      project: z.string(),
      wiki: z.string(),
      path: z.string().describe("Page path from list_ado_wiki_pages"),
      max_chars: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ source, project, wiki, path, max_chars }) => {
    const { conn, client } = await resolveAdoClient(source);
    const page = await client.getWikiPage(project, wiki, path);
    const limit = max_chars ?? 20_000;
    const truncated = page.content.length > limit;
    const textOut = truncated ? page.content.slice(0, limit) : page.content;
    const redact = resolveRedactionPolicy(conn.config).enabled;
    const map = new TokenMap();
    return out({
      path: page.path,
      remote_url: page.remoteUrl ?? null,
      chars: page.content.length,
      truncated,
      content: redact ? scrubText(textOut, map) : textOut,
      ...(redact
        ? {
            redaction:
              "Placeholders like [EMAIL_1]/[SECRET_1] are intentional redactions — treat them as opaque, never guess the originals.",
          }
        : {}),
      next: "Summarize and propose where this belongs (reference doc, knowledge entry, or component). Save only after the user approves; cite remote_url as the doc's source.",
    });
  },
);

tool(
  "get_ado_work_item_schema",
  {
    description:
      "Discover what an Azure DevOps project requires to create a work item. Without type: lists the project's work item types. With type: returns each field's reference name, whether it is required, allowed values, and defaults, plus any per-project defaults configured on the connection (config.defaults[project][type]). ALWAYS call this before create_ado_work_item — required fields differ per project and type.",
    inputSchema: {
      source: z.string(),
      project: z.string(),
      type: z.string().optional().describe("Work item type, e.g. 'Bug'"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ source, project, type }) => {
    const { conn, client } = await resolveAdoClient(source);
    if (!type) {
      const types = await client.listWorkItemTypes(project);
      return out({
        work_item_types: types.map((t: any) => ({
          name: t.name,
          reference_name: t.referenceName,
          description: t.description ?? null,
        })),
        next: "Call again with type to get its fields.",
      });
    }
    const fields = await client.getTypeFields(project, type);
    const defaults =
      ((conn.config as any)?.defaults?.[project]?.[type] as
        | Record<string, unknown>
        | undefined) ?? {};
    const MAX_VALUES = 50;
    return out({
      project,
      type,
      fields: fields.map((f: any) => {
        const values = Array.isArray(f.allowedValues) ? f.allowedValues : [];
        return {
          reference_name: f.referenceName,
          name: f.name,
          required: f.alwaysRequired === true,
          ...(values.length
            ? {
                allowed_values: values.slice(0, MAX_VALUES),
                ...(values.length > MAX_VALUES
                  ? { allowed_values_truncated: true }
                  : {}),
              }
            : {}),
          ...(f.defaultValue != null ? { default_value: f.defaultValue } : {}),
        };
      }),
      config_defaults: defaults,
    });
  },
);

tool(
  "create_ado_work_item",
  {
    description:
      "Create a work item (Bug, Task, User Story, ...) in an Azure DevOps project. Call get_ado_work_item_schema FIRST and fill every required field — requirements differ per project/type; never guess. fields is keyed by ADO reference names (e.g. 'System.AreaPath', 'Microsoft.VSTS.Common.Severity'); connection config defaults for the project/type are applied underneath. description is plain text/HTML — ADO renders System.Description as HTML, markdown will NOT render. Present the full field set to the user for approval before calling. Requires a PAT with Work Items Read & Write.",
    inputSchema: {
      source: z.string(),
      project: z.string(),
      type: z.string(),
      title: z.string(),
      description: z.string().optional(),
      fields: z.record(z.string(), z.any()).optional(),
      parent_id: z.string().optional(),
      related_ids: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async (a) => {
    const { conn, client } = await resolveAdoClient(a.source);
    const defaults =
      ((conn.config as any)?.defaults?.[a.project]?.[a.type] as
        | Record<string, unknown>
        | undefined) ?? {};
    const merged: Record<string, unknown> = { ...defaults, ...(a.fields ?? {}) };
    merged["System.Title"] = a.title;
    if (a.description != null)
      merged["System.Description"] = /<[a-z][\s\S]*>/i.test(a.description)
        ? a.description
        : `<div>${a.description.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>`;
    if (a.tags?.length) merged["System.Tags"] = a.tags.join("; ");

    const patch: JsonPatchOp[] = Object.entries(merged).map(([k, v]) => ({
      op: "add",
      path: `/fields/${k}`,
      value: v,
    }));
    const relation = (rel: string, id: string): JsonPatchOp => ({
      op: "add",
      path: "/relations/-",
      value: {
        rel,
        url: `${client.orgUrl}/_apis/wit/workItems/${id}`,
      },
    });
    if (a.parent_id)
      patch.push(relation("System.LinkTypes.Hierarchy-Reverse", a.parent_id));
    for (const id of a.related_ids ?? [])
      patch.push(relation("System.LinkTypes.Related", id));

    const created = await client.createWorkItem(a.project, a.type, patch);
    await recordRun({
      userId: await resolveCurrentUserId(),
      mode: "create",
      meta: { source: a.source, project: a.project, type: a.type, ado_id: created.id },
    });
    return out({
      created: true,
      id: created.id,
      url:
        created._links?.html?.href ??
        `${client.orgUrl}/${encodeURIComponent(a.project)}/_workitems/edit/${created.id}`,
    });
  },
);

tool(
  "list_repos",
  {
    description:
      "List linked git repositories available for code search, with index freshness. index_status 'error' or a stale last_indexed_at means results may not reflect current code — say so when citing.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const rows = await listRepos();
    return out(
      rows.map((r) => ({
        slug: r.slug,
        url: r.url,
        product_slug: r.product_slug,
        default_branch: r.default_branch,
        index_status: r.index_status,
        indexed_commit: r.indexed_commit,
        last_indexed_at: r.last_indexed_at,
        file_count: r.file_count,
        chunk_count: r.chunk_count,
        ...(r.index_error ? { index_error: r.index_error } : {}),
      })),
    );
  },
);

tool(
  "search_code",
  {
    description:
      "Hybrid (semantic + trigram) search over the indexed code of linked repositories. Returns the top-matching chunks with path, line range, and the commit they were indexed at. Search with symptom terms, symbol names, or error strings; then use read_code_file to read narrowly around a hit. Results reflect the indexed commit, not necessarily the latest code — always cite path:start-end @ commit and mention index age when advising.",
    inputSchema: {
      query: z.string(),
      repo: z.string().optional().describe("Repo slug from list_repos"),
      product_slug: z.string().optional(),
      path_prefix: z.string().optional(),
      limit: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, repo, product_slug, path_prefix, limit }) => {
    const { productId } = await resolveScopeIds({ product_slug });
    const rows = await searchCode(query, {
      repoSlug: repo,
      productId,
      pathPrefix: path_prefix,
      limit,
    });
    await recordRun({
      userId: await resolveCurrentUserId(),
      mode: "code",
      meta: { query, repo: repo ?? null, hits: rows.length },
    });
    return outScrubbed(
      rows.map((r: any) => ({
        repo: r.repo_slug,
        path: r.path,
        lines: `${r.start_line}-${r.end_line}`,
        lang: r.lang,
        score: Number(r.score),
        snippet: r.snippet,
        indexed_commit: r.indexed_commit,
        indexed_days_ago: r.indexed_days_ago,
      })),
    );
  },
);

tool(
  "read_code_file",
  {
    description:
      "Read a bounded slice of a file from a linked repo at its indexed commit (max 400 lines per call). Use after search_code to see the surrounding context of a hit. Never paste whole files into answers or saved knowledge entries — quote only the relevant lines.",
    inputSchema: {
      repo: z.string(),
      path: z.string(),
      start_line: z.number().int().positive().optional(),
      end_line: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ repo, path, start_line, end_line }) => {
    return outScrubbed(
      await readCodeFile(repo, path, {
        startLine: start_line,
        endLine: end_line,
      }),
    );
  },
);

export { server };

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    await loadSettingsIntoEnv();
  } catch {
    /* keep env-only behavior */
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
