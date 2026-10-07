/** Reference docs, and the freeform context they are drafted from. */
import { z } from "zod";
import { resolveCurrentUserId } from "@tachy/core/access";
import { getCustomerIdBySlug } from "@tachy/core/catalog";
import {
  TokenMap,
  globalRedactionEnabled,
  scrubText,
} from "@tachy/core/compliance";
import {
  searchReferenceDocs,
  saveReferenceDoc,
  getReferenceDoc,
  listReferenceDocs,
  updateReferenceDoc,
  referenceDocLineage,
} from "@tachy/core/reference";
import { badInput } from "@tachy/core/infra";
import { referenceStatusSchema } from "@tachy/core/knowledge";
import type { ReferenceDocUpdate } from "@tachy/core/reference";
import { extractSource } from "../extract";
import { tool } from "../server";
import { GRADE_NOTE, out, searchOut, outScrubbed } from "../results";
import { mcpActor, requireCanEdit, referenceDocScope } from "../permissions";
import { structuredField } from "../fields";
import {
  componentIntoFilter,
  resolveScopeIds,
  loadContextSources,
} from "../context";

tool(
  "ingest_context",
  {
    description:
      "Load freeform project context from pasted text, local file paths, and/or URLs, and return the cleaned raw text for you to structure. PDF paths are text-extracted automatically. This tool ONLY reads - it never saves. Long sources are truncated at max_chars (default 20000); for large documents (big PDFs), preview here, then call save_reference_doc with body_path so the full text is extracted and saved server-side. After loading, classify the content and route each part: durable incident lessons → save_knowledge_entry; architecture facts → add_component; everything else (docs, runbooks, design notes, config explainers) → save_reference_doc. Say briefly how you routed it, then make the calls - each is gated by its own review box.",
    inputSchema: {
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      text: z.string().optional(),
      paths: z.array(z.string()).optional(),
      urls: z.array(z.string()).optional(),
      max_chars: z.number().int().positive().optional(),
    },
    // readOnlyHint because nothing here is persisted; openWorldHint because
    // `urls` reaches hosts outside this deployment, which is what a client
    // deciding whether to run this unattended needs to weigh.
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ product_slug, team_slug, text, paths, urls, max_chars }) => {
    const sources = await loadContextSources({ text, paths, urls });
    if (!sources.length)
      throw badInput("Provide at least one of: text, paths, urls");

    const maxChars = max_chars ?? 20_000;
    const redact = globalRedactionEnabled();
    const tokens = new TokenMap();
    return out({
      product_slug: product_slug ?? null,
      team_slug: team_slug ?? null,
      sources: sources.map((source) => {
        const truncated = source.text.length > maxChars;
        const textOut = truncated
          ? source.text.slice(0, maxChars)
          : source.text;
        return {
          source: source.source,
          chars: source.text.length,
          ...(source.pages != null ? { pages: source.pages } : {}),
          truncated,
          text: redact ? scrubText(textOut, tokens) : textOut,
          ...(truncated
            ? {
                note: `Truncated at ${maxChars} of ${source.text.length} chars - summarize from this preview; to save the FULL text as a reference doc, call save_reference_doc with body_path.`,
              }
            : {}),
        };
      }),
      ...(redact
        ? {
            redaction:
              "Placeholders like [EMAIL_1]/[SECRET_1] are intentional redactions - treat them as opaque, never guess the originals.",
          }
        : {}),
      next: "Summarize how this routes, then call save_knowledge_entry / save_reference_doc / add_component. Each call is gated by its own review box.",
    });
  },
);

tool(
  "save_reference_doc",
  {
    description:
      "Persist an APPROVED reference doc - freeform project context (docs, runbooks, architecture notes) that doesn't fit the issue→root_cause→resolution shape of a knowledge entry. The body is chunked and embedded so it surfaces in consult-mode search. Provide EITHER body (inline text) OR body_path (a local file - e.g. a large PDF - extracted server-side so the full text is saved without echoing it). Scope it with product_slug, and add component when the doc is about one part of that product (leave it off for general product docs). Pass doc_version when the source document carries a version label; pass supersedes with the id of the doc this replaces - the predecessor is archived and linked automatically, and search returns only the latest version. The call is gated by a review box the user can edit, so draft it and call rather than asking first.",
    inputSchema: {
      title: z.string(),
      body: z.string().optional(),
      body_path: z.string().optional(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      component: z.string().optional(),
      customer_slug: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Set only when the doc describes ONE customer's install (their addon, their configuration). Leave it off for anything true of the product generally - a customer here means the doc is cited as that customer's setup, not as how the product works.",
        ),
      source: z
        .string()
        .optional()
        .describe(
          "Where the content came from - a URL (an ADO wiki page's remote_url), file path or origin note. Provenance, not a connection slug.",
        ),
      tags: z.array(z.string()).optional(),
      status: referenceStatusSchema.optional(),
      structured: structuredField,
      doc_version: z.string().optional(),
      supersedes: z.string().optional(),
      source_project_id: z
        .string()
        .optional()
        .describe("From get_ado_wiki_page - the project this page belongs to"),
      external_key: z
        .string()
        .optional()
        .describe(
          "The wiki page path. With source_project_id, re-importing the page supersedes the previous revision instead of duplicating it.",
        ),
    },
  },
  async (args) => {
    if (!args.body === !args.body_path)
      throw badInput("Provide exactly one of body or body_path");
    const { productId, teamId } = await resolveScopeIds(args);
    if (productId || teamId || !args.supersedes)
      await requireCanEdit({ productId, teamId });
    else await requireCanEdit(await referenceDocScope(args.supersedes));

    let body = args.body;
    let pages: number | undefined;
    if (args.body_path) {
      const extracted = await extractSource(args.body_path);
      body = globalRedactionEnabled()
        ? scrubText(extracted.text, new TokenMap())
        : extracted.text;
      pages = extracted.pages;
    }
    const saved = await saveReferenceDoc({
      title: args.title,
      body: body!,
      productId,
      teamId,
      createdById: await resolveCurrentUserId(),
      actor: await mcpActor(),
      source: args.source,
      sourceProjectId: args.source_project_id,
      externalKey: args.external_key,
      tags: args.tags,
      status: args.status ?? "approved",
      structured: args.structured,
      docVersion: args.doc_version,
      supersedes: args.supersedes,
      component: args.component,
      customerSlug: args.customer_slug,
    });
    return out({
      saved: true,
      id: saved.id,
      status: saved.status,
      chunks: saved.chunks,
      body_chars: body!.length,
      ...(pages != null ? { pages } : {}),
    });
  },
);

tool(
  "search_reference",
  {
    description: `Semantic search over approved reference docs (project context). Returns the best-matching snippet per doc. Only the latest approved version of a doc is returned. Filter by product_slug / team_slug (slug or alias) and tags. ${GRADE_NOTE}`,
    inputSchema: {
      query: z.string(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      component: z.string().optional(),
      customer: z
        .string()
        .optional()
        .describe(
          "Customer slug from list_customers. Ranks that customer's own material first WITHOUT hiding the rest.",
        ),
      doc_version: z.string().optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().int().positive().max(100).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({
    query,
    product_slug,
    team_slug,
    component,
    customer,
    doc_version,
    tags,
    limit,
  }) => {
    const { productId, teamId } = await resolveScopeIds({
      product_slug,
      team_slug,
    });
    return searchOut(
      await searchReferenceDocs(query, {
        productId,
        teamId,
        includeUnscoped: true,
        ...(await componentIntoFilter(productId, component, tags)),
        boostCustomerId: customer
          ? await getCustomerIdBySlug(customer)
          : undefined,
        docVersion: doc_version,
        limit,
      }),
      "search_reference",
    );
  },
);

tool(
  "list_reference_docs",
  {
    description:
      "List reference docs (newest first), optionally filtered by status, product_slug / team_slug, component, doc_version or tags. Bodies are omitted; use get_reference_doc for the full text. Rows carry doc_version and superseded_by - archived rows with superseded_by set are old versions of a newer doc.",
    inputSchema: {
      status: referenceStatusSchema.optional(),
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      component: z.string().optional(),
      doc_version: z.string().optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().int().positive().max(100).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({
    status,
    product_slug,
    team_slug,
    component,
    doc_version,
    tags,
    limit,
  }) => {
    const { productId, teamId } = await resolveScopeIds({
      product_slug,
      team_slug,
    });
    return outScrubbed(
      await listReferenceDocs({
        status,
        productId,
        teamId,
        ...(await componentIntoFilter(productId, component, tags)),
        docVersion: doc_version,
        limit,
      }),
    );
  },
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
      "Update a reference doc, or change its status ('archived' to retire). Pass only the fields you want to change. If the body changes it is re-chunked and re-embedded. To publish a NEW VERSION of a doc, do not edit the body here - call save_reference_doc with supersedes instead. Pass expected_version (from list/get) to guard against concurrent edits.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      body: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: referenceStatusSchema.optional(),
      source: z.string().nullable().optional(),
      structured: structuredField,
      doc_version: z.string().nullable().optional(),
      customer_slug: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Re-file whose install this documents; null makes it general again.",
        ),
      expected_version: z.number().int().optional(),
    },
  },
  async (args) => {
    await requireCanEdit(await referenceDocScope(args.id));
    const patch: ReferenceDocUpdate = {};
    if (args.title !== undefined) patch.title = args.title;
    if (args.body !== undefined) patch.body = args.body;
    if (args.tags !== undefined) patch.tags = args.tags;
    if (args.status !== undefined) patch.status = args.status;
    if (args.source !== undefined) patch.source = args.source;
    if (args.structured !== undefined) patch.structured = args.structured;
    if (args.doc_version !== undefined) patch.docVersion = args.doc_version;
    if (args.customer_slug !== undefined)
      patch.customerSlug = args.customer_slug;
    if (args.expected_version !== undefined)
      patch.expectedVersion = args.expected_version;
    const row = await updateReferenceDoc(args.id, patch, await mcpActor());
    return out({
      updated: true,
      id: row.id,
      status: row.status,
      version: row.version,
    });
  },
);
