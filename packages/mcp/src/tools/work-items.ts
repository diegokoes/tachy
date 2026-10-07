/**
 * The work item itself: reading it from its source, shrinking a long one, and
 * writing back to it (the private note, whose customer it is, and the version
 * it was seen on).
 */
import { z } from "zod";
import { resolveSource, resolveProjectContext } from "@tachy/core/sources";
import {
  ingestWorkItem,
  compactWorkItem,
  renderCompactHtml,
  splitNoteBody,
  externalWorkItemScope,
  workItemScope,
} from "@tachy/core/work-items";
import { searchKnowledge } from "@tachy/core/knowledge";
import { resolveCurrentUserId } from "@tachy/core/access";
import { recordRun } from "@tachy/core/analytics";
import {
  getCustomerIdBySlug,
  getCustomerSlug,
  setWorkItemCustomer,
  setObservedVersion,
} from "@tachy/core/catalog";
import {
  resolveRedactionPolicy,
  redactForLlm,
  scrubDeep,
  TokenMap,
} from "@tachy/core/compliance";
import { searchReferenceDocs } from "@tachy/core/reference";
import { embedQueryLiteral } from "@tachy/core/search";
import { badInput } from "@tachy/core/infra";
import { tool } from "../server";
import { NO_MATCHES, forAgent, out } from "../results";
import { requireCanEdit } from "../permissions";
import { limitField, sourceSlug } from "../fields";
import {
  capTurns,
  withCompaction,
  withLinkedAdoItems,
  workItemFacts,
} from "../context";

/** How much of the first incoming message goes into the search query. */
const QUERY_LEAD_CHARS = 1000;

tool(
  "fetch_work_item",
  {
    description:
      "Fetch a work item (ticket/issue) from a source, store it, and return its normalized metadata + cleaned messages for analysis. Read the messages chronologically. linked_items holds the Azure DevOps items this ticket references, already fetched - they usually carry the engineering side of the story, so treat them as part of the ticket; never re-fetch them and never fetch relations of relations. component is the area→component match when the project has a rule for it. A long, repetitive ticket comes back as transcript + compaction instead of item.messages.",
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
    const forLlm = resolveRedactionPolicy(conn.config).enabled
      ? redactForLlm(raw, src.redactRaw, await getCustomerSlug(item.customerId))
      : raw;
    return out({
      work_item_id: item.id,
      source_project_id: item.sourceProjectId,
      product_id: item.productId,
      team_id: item.teamId,
      ...(await workItemFacts(item, raw)),
      ...withCompaction(forLlm),
      ...(await withLinkedAdoItems(raw, item.id)),
    });
  },
);

tool(
  "compact_work_item",
  {
    description:
      "Compact a long ticket into a de-duplicated, attributed turn list ('X: ...' script) and post it back as a private note. Deterministic text processing, no summarising: it strips quoted reply chains, signatures, legal footers, security banners and automated reminders, drops repeated blocks, and recovers content that only ever existed inside a quote (attributed to its real sender and date). post_note (default true) writes the transcript to the ticket where it is readable in full; the reply here is only the stats, because a whole transcript does not belong in the conversation. Ask for return_turns only when you must reason over the text itself - it is truncated to fit, so the note remains the complete copy.",
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
        // Only once the replacement is on the ticket, and only for notes this
        // tool wrote and identifies by its own marker.
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
  "get_context",
  {
    description:
      "Fetch a work item AND auto-search the archive for similar prior cases in one call - the consult-mode entry point. Returns 'similar' (past knowledge entries with their full structured context) and 'reference' (matching project reference docs), each graded; check every similar entry's status, because a 'deprecated' one is outdated and must be flagged as such rather than presented as current advice. 'linked_items' holds the referenced Azure DevOps items, already fetched - read them, never re-fetch. 'project_context' names the ticket's project, its wiki and its repos with the component each implements: use it to aim search_code at the right repo instead of searching everything. A long, repetitive ticket comes back as transcript + compaction instead of item.messages.",
    inputSchema: {
      source: sourceSlug,
      external_id: z.string(),
      limit: limitField,
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

    // A whole first message overruns the embedding window, which drops the
    // tail. The lead carries the symptom.
    const firstIncoming = (
      raw.messages.find((m) => m.direction === "incoming")?.bodyText ?? ""
    ).slice(0, QUERY_LEAD_CHARS);
    const query = [raw.title, firstIncoming].filter(Boolean).join(" ");
    const productId = item.productId ?? undefined;
    // Embedded once for both searches.
    const queryVector = query.trim()
      ? await embedQueryLiteral(query)
      : undefined;
    // The ticket's own customer lifts their history without excluding anyone
    // else's: the tiebreaker search_knowledge gives an explicit `customer`.
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
      ...(await workItemFacts(item, raw)),
      ...(context.length ? { project_context: context } : {}),
      ...(await withLinkedAdoItems(raw, item.id)),
    });
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
          "Private note text. It lands on the customer's own ticket in their helpdesk - private to your organisation, not to you, and visible to every agent who opens it. Write it as something a colleague will read six months from now.",
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
          "Which part of that customer's estate the ticket concerns - a unit slug or alias from list_customer_units. Only meaningful alongside a customer.",
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
      "Record (or clear) the product version observed/mentioned on a specific ticket. Only set this when a version is actually known from the ticket - leave unset otherwise.",
    inputSchema: { work_item_id: z.string(), version: z.string().nullable() },
  },
  async ({ work_item_id, version }) => {
    await requireCanEdit(await workItemScope(work_item_id));
    await setObservedVersion(work_item_id, version);
    return out({ updated: true, work_item_id, observed_version: version });
  },
);
