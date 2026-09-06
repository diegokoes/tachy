import { z } from "zod";
import {
  resolveSource,
  ingestWorkItem,
  saveKnowledgeEntry,
  searchKnowledge,
  resolveCurrentUserId,
  addFeedback,
  recordRun,
  getCustomerIdBySlug,
  getCustomerName,
  getCustomerSlug,
  resolveRedactionPolicy,
  redactForLlm,
  compactWorkItem,
  renderCompactHtml,
  splitNoteBody,
  scrubDeep,
  TokenMap,
  searchReferenceDocs,
  embedQueryLiteral,
  resolveProjectContext,
  cloudSchema,
  resolutionClaritySchema,
  badInput,
  knowledgeStatusSchema,
  confidenceSchema,
  feedbackKindSchema,
  runModeSchema,
  externalWorkItemScope,
} from "@tachy/core";
import { tool } from "../server";
import { GRADE_NOTE, NO_MATCHES, forAgent, out, searchOut } from "../results";
import {
  knowledgeEntryScope,
  mcpActor,
  newEntryScope,
  requireCanEdit,
} from "../permissions";
import {
  signalsField,
  sourceSlug,
  structuredField,
  symptomsField,
  tagsField,
} from "../fields";
import {
  capTurns,
  componentIntoFilter,
  resolveScopeIds,
  unresolvedCustomer,
  unresolvedUnit,
  withCompaction,
  withCustomerProfile,
  withLinkedAdoItems,
} from "../context";

/**
 * The consult loop: reading a work item, searching the archive for what was
 * learned before, and writing back what this one taught.
 */

tool(
  "fetch_work_item",
  {
    description:
      "Fetch a work item (ticket/issue) from a source, store it, and return its normalized metadata + cleaned messages for analysis. Read the messages chronologically. linked_items holds the Azure DevOps items this ticket references, already fetched — they usually carry the engineering side of the story, so treat them as part of the ticket; never re-fetch them and never fetch relations of relations. component is the area→component match when the project has a rule for it. A long, repetitive ticket comes back as transcript + compaction instead of item.messages.",
    inputSchema: {
      source: sourceSlug,
      external_id: z.string(),
    },
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
    return out({
      work_item_id: item.id,
      source_project_id: item.sourceProjectId,
      product_id: item.productId,
      team_id: item.teamId,
      customer_id: item.customerId,
      customer_name: customerName,
      ...unresolvedCustomer(item.customerId, item.customerAmbiguity),
      ...(await unresolvedUnit(
        item.customerId,
        item.customerUnitId,
        `${raw.title ?? ""} ${raw.messages
          .map((m) => m.bodyText ?? "")
          .join(" ")
          .slice(0, 4000)}`,
      )),
      ...(await withCustomerProfile(item.customerId)),
      observed_version: item.observedVersion,
      ...(item.componentSlug ? { component: item.componentSlug } : {}),
      ...withCompaction(forLlm),
      ...(await withLinkedAdoItems(raw, item.id)),
    });
  },
);

tool(
  "compact_work_item",
  {
    description:
      "Compact a long ticket into a de-duplicated, attributed turn list ('X: ...' script) and post it back as a private note. Deterministic text processing, no summarising: it strips quoted reply chains, signatures, legal footers, security banners and automated reminders, drops repeated blocks, and recovers content that only ever existed inside a quote (attributed to its real sender and date). post_note (default true) writes the transcript to the ticket where it is readable in full; the reply here is only the stats, because a whole transcript does not belong in the conversation. Ask for return_turns only when you must reason over the text itself — it is truncated to fit, so the note remains the complete copy.",
    inputSchema: {
      source: sourceSlug,
      external_id: z.string(),
      post_note: z.boolean().optional(),
      replace_previous: z.boolean().optional(),
      return_turns: z.boolean().optional(),
      keep_automated: z.boolean().optional(),
    },
  },
  async ({
    source,
    external_id,
    post_note,
    replace_previous,
    return_turns,
    keep_automated,
  }) => {
    const { conn, source: src } = await resolveSource(source);
    const raw = await src.fetchItem(external_id);
    const item = await ingestWorkItem(conn.id, raw);
    const opts = { keepAutomated: keep_automated === true };
    const full = compactWorkItem(raw, opts);

    let posted: { notes: number; replaced_previous?: number } | undefined;
    let postFailed: string | undefined;
    if (post_note !== false) {
      if (!src.postNote)
        postFailed = `Source '${source}' does not support notes`;
      else {
        await requireCanEdit(await externalWorkItemScope(conn.id, external_id));
        const bodies = splitNoteBody(renderCompactHtml(full));
        for (const body of bodies)
          await src.postNote(external_id, body, { private: true });
        posted = { notes: bodies.length };
        // Only once the replacement is safely on the ticket, and only for notes
        // this tool wrote and can still identify by its own marker.
        if (replace_previous !== false && src.deleteNote) {
          let replaced = 0;
          for (const id of full.prior_transcript_ids)
            await src.deleteNote(id).then(
              () => replaced++,
              () => {},
            );
          if (replaced) posted.replaced_previous = replaced;
        }
      }
    }

    const forLlm = resolveRedactionPolicy(conn.config).enabled
      ? compactWorkItem(
          redactForLlm(
            raw,
            src.redactRaw,
            await getCustomerSlug(item.customerId),
          ),
          opts,
        )
      : full;

    const { turns, ...summary } = forLlm;
    return out({
      work_item_id: item.id,
      ...summary,
      ...(return_turns === true ? capTurns(turns) : {}),
      ...(posted
        ? {
            posted_private_note: posted,
            next: "The full transcript is on the ticket as a private note. Report the stats briefly; do not restate the transcript.",
          }
        : {}),
      ...(postFailed ? { note_not_posted: postFailed } : {}),
    });
  },
);

tool(
  "search_knowledge",
  {
    description: `Search prior knowledge entries by keyword / symptom / error code. Use for consult mode. Results may include status 'deprecated' entries (possibly with superseded_by pointing at their replacement) — warn that those are outdated, never present them as current advice. Filter with product_slug / team_slug (slugs or aliases — not UUIDs), tags (entry must carry at least one), and/or component (matches the entry's linked component or its slug/aliases in tags). ${GRADE_NOTE}`,
    inputSchema: {
      query: z.string(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      tags: z.array(z.string()).optional(),
      component: z.string().optional(),
      customer: z
        .string()
        .optional()
        .describe(
          "Customer slug from list_customers. Ranks that customer's own material first WITHOUT hiding the rest — a fix found on one install is often the answer for the next.",
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
  "get_context",
  {
    description:
      "Fetch a work item AND auto-search the archive for similar prior cases in one call — the consult-mode entry point. Returns 'similar' (past knowledge entries with their full structured context) and 'reference' (matching project reference docs), each graded; check every similar entry's status, because a 'deprecated' one is outdated and must be flagged as such rather than presented as current advice. 'linked_items' holds the referenced Azure DevOps items, already fetched — read them, never re-fetch. 'project_context' names the ticket's project, its wiki and its repos with the component each implements: use it to aim search_code at the right repo instead of searching everything. A long, repetitive ticket comes back as transcript + compaction instead of item.messages.",
    inputSchema: {
      source: sourceSlug,
      external_id: z.string(),
      limit: z.number().int().positive().max(100).optional(),
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

    // The embedding window is 512 tokens; a whole first message overruns it and
    // the tail is dropped silently. The lead carries the symptom anyway.
    const firstIncoming = (
      raw.messages.find((m) => m.direction === "incoming")?.bodyText ?? ""
    ).slice(0, 1000);
    const query = [raw.title, firstIncoming].filter(Boolean).join(" ");
    const productId = item.productId ?? undefined;
    // One embedding, two searches — the same string was being embedded twice.
    const queryVector = query.trim()
      ? await embedQueryLiteral(query)
      : undefined;
    // The ticket's own customer lifts their history without excluding anyone
    // else's — the same tiebreaker search_knowledge gives an explicit `customer`.
    const boostCustomerId = item.customerId ?? undefined;
    const boostUnitId = item.customerUnitId ?? undefined;
    const [similar, reference] = await Promise.all([
      searchKnowledge(query, {
        productId,
        limit,
        includeUnscoped: true,
        queryVector,
        boostCustomerId,
        boostUnitId,
      }),
      searchReferenceDocs(query, {
        productId,
        limit,
        includeUnscoped: true,
        queryVector,
        boostCustomerId,
      }),
    ]);
    const customerName = await getCustomerName(item.customerId);

    const redact = resolveRedactionPolicy(conn.config).enabled;
    const forLlm = redact
      ? redactForLlm(raw, src.redactRaw, await getCustomerSlug(item.customerId))
      : raw;
    const retrievalMap = new TokenMap();
    const { item: workItem, ...compaction } = withCompaction(forLlm);
    const context = await resolveProjectContext({ workItemId: item.id });
    return out({
      work_item: workItem,
      ...compaction,
      similar: redact
        ? scrubDeep(forAgent(similar), retrievalMap)
        : forAgent(similar),
      reference: redact
        ? scrubDeep(forAgent(reference), retrievalMap)
        : forAgent(reference),
      ...(similar.length || reference.length
        ? {}
        : { retrieval_note: NO_MATCHES }),
      customer_id: item.customerId,
      customer_name: customerName,
      ...unresolvedCustomer(item.customerId, item.customerAmbiguity),
      ...(await unresolvedUnit(
        item.customerId,
        item.customerUnitId,
        `${raw.title ?? ""} ${raw.messages
          .map((m) => m.bodyText ?? "")
          .join(" ")
          .slice(0, 4000)}`,
      )),
      ...(await withCustomerProfile(item.customerId)),
      observed_version: item.observedVersion,
      ...(item.componentSlug ? { component: item.componentSlug } : {}),
      ...(context.length ? { project_context: context } : {}),
      ...(await withLinkedAdoItems(raw, item.id)),
    });
  },
);

tool(
  "save_knowledge_entry",
  {
    description:
      "Persist a structured knowledge entry. The call is gated by a review box the user can edit before it runs, so draft it and call — do not ask for approval in prose first. resolution_pattern must be an existing slug from list_resolution_patterns (or omitted) — it is not free text. component must be an existing slug/alias from list_components; if the ticket's area is missing from the glossary, call add_component first — it gets its own review box — then save. product_area is derived automatically from the component hierarchy — it is not an input. For manual entries (no work_item_id) that set component, pass product_slug — component slugs resolve within a product.",
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
      customer_slug: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Set ONLY when the lesson is true of one customer's install and not of the product — their addon, their configuration, their version. It is not inherited from the ticket, and whose ticket it was is not the test: most problems found on a customer's ticket are the product's behaviour and must stay general, or they will not be found for anyone else. Setting it makes every future answer cite the entry as that customer's case.",
        ),
      unit: z
        .string()
        .optional()
        .describe(
          "Which part of that customer's estate it was learned on — a unit slug from list_customer_units. Needs customer_slug. When the entry comes from a ticket already filed against a unit AND you name that same customer, it is inherited automatically, so pass this only to override.",
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
          "The underlying technical cause, stated precisely. Omit rather than guess — an unknown cause means confidence 'low'.",
        ),
      resolution: z
        .string()
        .optional()
        .describe("What was done, or should be done, to fix it."),
      resolution_pattern: z
        .string()
        .optional()
        .describe(
          "Slug from list_resolution_patterns — a controlled vocabulary, never free text. Omit entirely if none fits.",
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
          "How sure you are that the root_cause and resolution written here are CORRECT — a property of this entry, not of the ticket. 'high': cause identified and the fix confirmed to address it. 'medium': plausible cause, fix worked but was never confirmed to be the reason. 'low': cause unknown or guessed. No root_cause means 'low'.",
        ),
      tags: tagsField,
      cloud: cloudSchema
        .optional()
        .describe(
          "Environment the issue was observed in — lowercase slug (e.g. prod, qa, dev). Call list_environments first and reuse an existing value when one fits.",
        ),
      resolution_clarity: resolutionClaritySchema
        .optional()
        .describe(
          "Whether the ticket actually ended in a fix — a property of what happened, not of how sure you are. 'clear': a specific fix was applied and the issue confirmed gone. 'partial': mitigated or worked around, the underlying cause still stands. 'unclear': closed with no real resolution — it stopped recurring, the customer went quiet, nobody identified a fix. Independent of confidence: a restart that verifiably fixed it with no known cause is clear + low; a cause you fully understand that was never fixed is unclear + high.",
        ),
      hidden_fix: z
        .boolean()
        .optional()
        .describe(
          "True when the real fix was not visible on the ticket surface — the reporter's described problem and the actual cause diverged. Marks the entries worth reading before trusting a ticket at face value, and is filterable in the library.",
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
  "post_private_note",
  {
    description:
      "Write a private note back to the source work item (e.g. a Freshdesk private note) with the learned analysis.",
    inputSchema: {
      source: sourceSlug,
      external_id: z.string(),
      body: z
        .string()
        .describe(
          "Private note text. It lands on the customer's own ticket in their helpdesk — private to your organisation, not to you, and visible to every agent who opens it. Write it as something a colleague will read six months from now.",
        ),
    },
  },
  async ({ source, external_id, body }) => {
    const { conn, source: src } = await resolveSource(source);
    if (!src.postNote)
      throw badInput(`Source '${source}' does not support notes`);
    await requireCanEdit(await externalWorkItemScope(conn.id, external_id));
    await src.postNote(external_id, body, { private: true });
    return out({ posted: true, private: true, external_id, body });
  },
);

tool(
  "add_knowledge_feedback",
  {
    description:
      "Record human feedback (a correction, rating, or note) on an existing knowledge entry, so it can be improved over time. kind 'deprecation' records WHY an entry is outdated — the actual retirement is a separate update_knowledge_entry call with status 'deprecated'.",
    inputSchema: {
      knowledge_entry_id: z.string(),
      kind: feedbackKindSchema.optional(),
      rating: z.number().int().min(1).max(5).optional(),
      comment: z.string().optional(),
      patch: z
        .record(z.string(), z.any())
        .optional()
        .describe(
          "A proposed correction, recorded alongside the feedback rather than applied. Nothing reads it back automatically — a curator decides. To actually change an entry, call update_knowledge_entry.",
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
  "record_analysis_run",
  {
    description:
      "Report token usage for an ingest/consult analysis run, for audit and cost accounting. Pass the input/output tokens you used.",
    inputSchema: {
      mode: runModeSchema,
      work_item_id: z.string().optional(),
      model: z.string().optional(),
      input_tokens: z
        .number()
        .int()
        .optional()
        .describe(
          "Actual tokens consumed. These rows are what the cost report adds up, so an estimate here becomes a figure someone reads as measured.",
        ),
      output_tokens: z.number().int().optional(),
      meta: z
        .record(z.string(), z.any())
        .optional()
        .describe(
          "Free-form context for this run — the work item, the source, what was attempted. Not a place for the content itself.",
        ),
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
