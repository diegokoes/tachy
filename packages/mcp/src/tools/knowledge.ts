import { z } from "zod";
import {
  saveKnowledgeEntry,
  searchKnowledge,
  addFeedback,
  cloudSchema,
  resolutionClaritySchema,
  knowledgeStatusSchema,
  confidenceSchema,
  feedbackKindSchema,
  updateKnowledgeEntry,
  getKnowledgeEntry,
  listKnowledgeEntries,
  listEnvironments,
} from "@tachy/core/knowledge";
import { resolveCurrentUserId } from "@tachy/core/access";
import { getCustomerIdBySlug } from "@tachy/core/catalog";
import type { KnowledgeUpdateInput } from "@tachy/core/knowledge";
import { tool } from "../server";
import { GRADE_NOTE, out, searchOut, outScrubbed } from "../results";
import {
  knowledgeEntryScope,
  mcpActor,
  newEntryScope,
  requireCanEdit,
} from "../permissions";
import {
  knowledgeFilterFields,
  signalsField,
  structuredField,
  symptomsField,
  tagsField,
} from "../fields";
import { componentIntoFilter, resolveScopeIds } from "../context";

/**
 * The archive of what past work items taught: searching it, adding to it, and
 * correcting an entry once it exists.
 */

tool(
  "search_knowledge",
  {
    description: `Search prior knowledge entries by keyword / symptom / error code. Use for consult mode. Results may include status 'deprecated' entries (possibly with superseded_by pointing at their replacement) - warn that those are outdated, never present them as current advice. Filter with product_slug / team_slug (slugs or aliases - not UUIDs), tags (entry must carry at least one), and/or component (matches the entry's linked component or its slug/aliases in tags). ${GRADE_NOTE}`,
    inputSchema: {
      query: z.string(),
      ...knowledgeFilterFields,
      component: z.string().optional(),
      customer: z
        .string()
        .optional()
        .describe(
          "Customer slug from list_customers. Ranks that customer's own material first WITHOUT hiding the rest - a fix found on one install is often the answer for the next.",
        ),
    },
    annotations: { readOnlyHint: true },
  },
  async ({
    query,
    product_slug,
    team_slug,
    tags,
    component,
    customer,
    cloud,
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
      boostCustomerId: customer
        ? await getCustomerIdBySlug(customer)
        : undefined,
      cloud,
      affectedVersion: affected_version,
      fixedVersion: fixed_version,
      limit,
    });
    return searchOut(rows, "search_knowledge");
  },
);

tool(
  "save_knowledge_entry",
  {
    description:
      "Persist a structured knowledge entry. The call is gated by a review box the user can edit before it runs, so draft it and call - do not ask for approval in prose first. resolution_pattern must be an existing slug from list_resolution_patterns (or omitted) - it is not free text. component must be an existing slug/alias from list_components; if the ticket's area is missing from the glossary, call add_component first - it gets its own review box - then save. product_area is derived automatically from the component hierarchy - it is not an input. For manual entries (no work_item_id) that set component, pass product_slug - component slugs resolve within a product.",
    inputSchema: {
      work_item_id: z.string().optional(),
      product_slug: z
        .string()
        .optional()
        .describe(
          "Product slug or alias - the normal way to scope an entry. Required for manual entries that set component.",
        ),
      team_slug: z.string().optional().describe("Team slug or alias."),
      product_id: z
        .string()
        .optional()
        .describe(
          "Product UUID - only if you already hold one (e.g. from fetch_work_item); otherwise use product_slug.",
        ),
      team_id: z
        .string()
        .optional()
        .describe("Team UUID - otherwise use team_slug."),
      customer_slug: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Set ONLY when the lesson is true of one customer's install and not of the product - their addon, their configuration, their version. It is not inherited from the ticket, and whose ticket it was is not the test: most problems found on a customer's ticket are the product's behaviour and must stay general, or they will not be found for anyone else. Setting it makes every future answer cite the entry as that customer's case.",
        ),
      unit: z
        .string()
        .optional()
        .describe(
          "Which part of that customer's estate it was learned on - a unit slug from list_customer_units. Needs customer_slug. When the entry comes from a ticket already filed against a unit AND you name that same customer, it is inherited automatically, so pass this only to override.",
        ),
      status: knowledgeStatusSchema.optional(),
      issue_summary: z
        .string()
        .optional()
        .describe(
          "One-paragraph summary of the problem, with error codes and key symptoms inline.",
        ),
      symptoms: symptomsField,
      signals: signalsField,
      root_cause: z
        .string()
        .optional()
        .describe(
          "The underlying technical cause, stated precisely. Omit rather than guess - an unknown cause means confidence 'low'.",
        ),
      resolution: z
        .string()
        .optional()
        .describe("What was done, or should be done, to fix it."),
      resolution_pattern: z
        .string()
        .optional()
        .describe(
          "Slug from list_resolution_patterns - a controlled vocabulary, never free text. Omit entirely if none fits.",
        ),
      component: z
        .string()
        .optional()
        .describe(
          "Slug or alias from list_components. Unknown values are rejected with nearest-match suggestions.",
        ),
      confidence: confidenceSchema
        .optional()
        .describe(
          "How sure you are that the root_cause and resolution written here are CORRECT - a property of this entry, not of the ticket. 'high': cause identified and the fix confirmed to address it. 'medium': plausible cause, fix worked but was never confirmed to be the reason. 'low': cause unknown or guessed. No root_cause means 'low'.",
        ),
      tags: tagsField,
      cloud: cloudSchema
        .optional()
        .describe(
          "Environment the issue was observed in - lowercase slug (e.g. prod, qa, dev). Call list_environments first and reuse an existing value when one fits.",
        ),
      resolution_clarity: resolutionClaritySchema
        .optional()
        .describe(
          "Whether the ticket actually ended in a fix - a property of what happened, not of how sure you are. 'clear': a specific fix was applied and the issue confirmed gone. 'partial': mitigated or worked around, the underlying cause still stands. 'unclear': closed with no real resolution - it stopped recurring, the customer went quiet, nobody identified a fix. Independent of confidence: a restart that verifiably fixed it with no known cause is clear + low; a cause you fully understand that was never fixed is unclear + high.",
        ),
      hidden_fix: z
        .boolean()
        .optional()
        .describe(
          "True when the real fix was not visible on the ticket surface - the reporter's described problem and the actual cause diverged. Marks the entries worth reading before trusting a ticket at face value, and is filterable in the library.",
        ),
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
      structured: structuredField,
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
      customerSlug: a.customer_slug,
      unit: a.unit,
      createdById: await resolveCurrentUserId(),
      actor: await mcpActor(),
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
      hiddenFix: a.hidden_fix,
      affectedVersion: a.affected_version,
      fixedVersion: a.fixed_version,
      structured: a.structured,
    });
    return out({ saved: true, id: row.id, status: row.status });
  },
);

tool(
  "add_knowledge_feedback",
  {
    description:
      "Record human feedback (a correction, rating, or note) on an existing knowledge entry, so it can be improved over time. kind 'deprecation' records WHY an entry is outdated - the actual retirement is a separate update_knowledge_entry call with status 'deprecated'.",
    inputSchema: {
      knowledge_entry_id: z.string(),
      kind: feedbackKindSchema.optional(),
      rating: z.number().int().min(1).max(5).optional(),
      comment: z.string().optional(),
      patch: z
        .record(z.string(), z.any())
        .optional()
        .describe(
          "A proposed correction, recorded alongside the feedback rather than applied. Nothing reads it back automatically - a curator decides. To actually change an entry, call update_knowledge_entry.",
        ),
    },
  },
  async (a) => {
    await requireCanEdit(await knowledgeEntryScope(a.knowledge_entry_id));
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
  "update_knowledge_entry",
  {
    description:
      "Update fields on an existing knowledge entry, or change its status. Mark outdated knowledge with status 'deprecated' (it stays searchable but flagged; set superseded_by when a newer entry replaces it) - reserve 'archived' for entries that should vanish from search entirely. Pass only the fields you want to change; omitted fields are left as-is. Nullable fields (issue_summary, root_cause, etc.) accept null to clear them. component takes a slug/alias from list_components (product_area is re-derived from it; null clears both). The search results include 'version' - pass it as expected_version to guard against concurrent edits.",
    inputSchema: {
      id: z.string(),
      status: knowledgeStatusSchema.optional(),
      issue_summary: z.string().nullable().optional(),
      root_cause: z.string().nullable().optional(),
      resolution: z.string().nullable().optional(),
      resolution_pattern: z.string().nullable().optional(),
      symptoms: symptomsField,
      signals: signalsField,
      tags: tagsField,
      component: z.string().nullable().optional(),
      customer_slug: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Re-file whose install this was learned on; null makes the lesson general again.",
        ),
      superseded_by: z.string().nullable().optional(),
      confidence: confidenceSchema.nullable().optional(),
      cloud: cloudSchema
        .nullable()
        .optional()
        .describe(
          "Environment slug - reuse an existing value from list_environments when one fits; null clears it.",
        ),
      resolution_clarity: resolutionClaritySchema.nullable().optional(),
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
      structured: structuredField,
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
    if (a.customer_slug !== undefined) patch.customerSlug = a.customer_slug;
    if (a.superseded_by !== undefined) patch.supersededBy = a.superseded_by;
    if (a.confidence !== undefined) patch.confidence = a.confidence;
    if (a.cloud !== undefined) patch.cloud = a.cloud;
    if (a.resolution_clarity !== undefined)
      patch.resolutionClarity = a.resolution_clarity;
    if (a.hidden_fix !== undefined) patch.hiddenFix = a.hidden_fix;
    if (a.affected_version !== undefined)
      patch.affectedVersion = a.affected_version;
    if (a.fixed_version !== undefined) patch.fixedVersion = a.fixed_version;
    if (a.structured !== undefined) patch.structured = a.structured;
    if (a.expected_version !== undefined)
      patch.expectedVersion = a.expected_version;
    const row = await updateKnowledgeEntry(a.id, patch, await mcpActor());
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
      "List knowledge entries (newest first), optionally filtered by status (e.g. 'draft' to find pending entries, 'deprecated' to review outdated ones), product_slug / team_slug (slug or alias), or tags. Useful for review and curation - not semantic search; use search_knowledge for consult.",
    inputSchema: {
      status: knowledgeStatusSchema.optional(),
      ...knowledgeFilterFields,
      component: z
        .string()
        .optional()
        .describe(
          "Component slug/alias: matches the entry's linked component or its slug/aliases in tags. Needs product_slug.",
        ),
    },
    annotations: { readOnlyHint: true },
  },
  async ({
    status,
    product_slug,
    team_slug,
    tags,
    component,
    cloud,
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
      cloud,
      affectedVersion: affected_version,
      fixedVersion: fixed_version,
      limit,
    });
    return outScrubbed(rows);
  },
);

tool(
  "list_environments",
  {
    description:
      "List the environments ('cloud' values) already used by knowledge entries in this deployment, with usage counts. The vocabulary is deployment-specific (e.g. prod/qa vs dev/demo/preprod) - call this before setting `cloud` on a save/update and reuse an existing slug when one fits, rather than inventing a near-duplicate.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => out(await listEnvironments()),
);
