import { z } from "zod";
import {
  updateKnowledgeEntry,
  getCustomerIdBySlug,
  setWorkItemCustomer,
  setObservedVersion,
  getKnowledgeEntry,
  listKnowledgeEntries,
  cloudSchema,
  resolutionClaritySchema,
  knowledgeStatusSchema,
  confidenceSchema,
  workItemScope,
} from "@tachy/core";
import type { KnowledgeUpdateInput } from "@tachy/core";
import { tool } from "../server";
import { out, outScrubbed } from "../results";
import { knowledgeEntryScope, mcpActor, requireCanEdit } from "../permissions";
import {
  signalsField,
  structuredField,
  symptomsField,
  tagsField,
} from "../fields";
import { componentIntoFilter, resolveScopeIds } from "../context";

/**
 * Attribution on the work item, and editing an entry once it exists.
 */

tool(
  "set_work_item_customer",
  {
    description:
      "Correct (or clear) the customer auto-matched to a work item. Use when the auto-match is wrong or missing, e.g. a ticket routed through a distributor.",
    inputSchema: {
      work_item_id: z.string(),
      unit: z
        .string()
        .optional()
        .describe(
          "Which part of that customer's estate the ticket concerns — a unit slug or alias from list_customer_units. Only meaningful alongside a customer.",
        ),
      customer_slug: z.string().nullable(),
    },
  },
  async ({ work_item_id, customer_slug, unit }) => {
    await requireCanEdit(await workItemScope(work_item_id));
    const customerId = customer_slug
      ? await getCustomerIdBySlug(customer_slug)
      : null;
    await setWorkItemCustomer(work_item_id, customerId, unit);
    return out({
      updated: true,
      work_item_id,
      customer_id: customerId,
      ...(unit ? { unit } : {}),
    });
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
    await requireCanEdit(await workItemScope(work_item_id));
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
          "Environment slug — reuse an existing value from list_environments when one fits; null clears it.",
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
      cloud: cloudSchema
        .optional()
        .describe(
          "Environment slug filter, e.g. prod — see list_environments.",
        ),
      affected_version: z.string().optional(),
      fixed_version: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
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
