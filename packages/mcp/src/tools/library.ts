import { z } from "zod";
import {
  resolveCurrentUserId,
  sql,
  getProductIdBySlug,
  getCustomerIdBySlug,
  globalRedactionEnabled,
  scrubText,
  TokenMap,
  saveReferenceDoc,
  getReferenceDoc,
  listReferenceDocs,
  updateReferenceDoc,
  searchReferenceDocs,
  referenceDocLineage,
  AppError,
  badInput,
  referenceStatusSchema,
  draftSources,
  wikiToc,
  findArticle,
  setArticleCategories,
  setComposedFrom,
} from "@tachy/core";
import type { ReferenceDocUpdate } from "@tachy/core";
import { extractSource } from "../extract";
import { tool } from "../server";
import { GRADE_NOTE, out, outScrubbed, searchOut } from "../results";
import { mcpActor, referenceDocScope, requireCanEdit } from "../permissions";
import { structuredField } from "../fields";
import {
  componentIntoFilter,
  loadContextSources,
  resolveScopeIds,
} from "../context";

/**
 * Reference docs and wiki articles, and the freeform context they are drafted
 * from.
 */

tool(
  "ingest_context",
  {
    description:
      "Load freeform project context from pasted text, local file paths, and/or URLs, and return the cleaned raw text for you to structure. PDF paths are text-extracted automatically. This tool ONLY reads — it never saves. Long sources are truncated at max_chars (default 20000); for large documents (big PDFs), preview here, then call save_reference_doc with body_path so the full text is extracted and saved server-side. After loading, classify the content and route each part: durable incident lessons → save_knowledge_entry; architecture facts → add_component; everything else (docs, runbooks, design notes, config explainers) → save_reference_doc. Say briefly how you routed it, then make the calls — each is gated by its own review box.",
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
                note: `Truncated at ${limit} of ${s.text.length} chars — summarize from this preview; to save the FULL text as a reference doc, call save_reference_doc with body_path.`,
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
      next: "Summarize how this routes, then call save_knowledge_entry / save_reference_doc / add_component. Each call is gated by its own review box.",
    });
  },
);

tool(
  "draft_wiki_page",
  {
    description:
      "Gather everything recorded under one component — knowledge entries and reference docs, including its sub-components — so a wiki article can be composed from them. Returns the substance, not just ids, so you can write from this one call. Use it when asked to write or refresh an article about a part of the product; then compose the article and call save_wiki_article with the ids you actually used in `sources`. Check the wiki's table of contents first (list_wiki_articles) so you extend the structure rather than duplicating a page that exists.",
    inputSchema: {
      product_slug: z.string(),
      component: z
        .string()
        .describe("Component slug; its sub-components are included."),
      limit: z.number().int().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async (a) => {
    const productId = await getProductIdBySlug(a.product_slug);
    const sources = await draftSources(productId, a.component, a.limit ?? 40);
    if (!sources.length)
      return out({
        sources: [],
        note: `Nothing is recorded under '${a.component}' yet, so there is nothing to consolidate. Say so rather than writing an article from general knowledge.`,
      });
    return outScrubbed({
      sources,
      next: "Compose the article, then call save_wiki_article with `sources` naming the ids you used. It lands as a draft for the user to approve.",
    });
  },
);

tool(
  "list_wiki_articles",
  {
    description:
      "The wiki's table of contents for one product: its categories, nested, with the articles filed under each, plus anything uncategorised. Read this before writing an article, so a new page joins the existing structure instead of duplicating it. Pass product_slug omitted for the org-wide wiki (material that belongs to no single product).",
    inputSchema: { product_slug: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  async (a) => {
    const productId = a.product_slug
      ? await getProductIdBySlug(a.product_slug)
      : null;
    return out(await wikiToc(productId));
  },
);

tool(
  "save_wiki_article",
  {
    description:
      "Write a wiki article — the canonical, browsable answer for a topic, as opposed to a knowledge entry (one incident) or a reference doc (imported material). The body is markdown; use ## headings, which become the article's contents box. Link to other articles with [[slug]], and to a knowledge entry with [[entry:<id>|short label]] — links are extracted on save and become backlinks. Saving with an existing slug UPDATES that article in place, keeping its links and its history. Always pass `sources` with the ids you composed from: that is what lets the page flag itself stale when the material behind it changes. Lands as a draft unless told otherwise; the call is gated by a review box the user can edit.",
    inputSchema: {
      slug: z
        .string()
        .describe(
          "Stable address, kebab-case. Reused on a later save to update the same article rather than making a second one.",
        ),
      title: z.string(),
      body: z
        .string()
        .describe("Markdown. ## headings become the contents box."),
      product_slug: z
        .string()
        .optional()
        .describe("Omit for the org-wide wiki."),
      categories: z
        .array(z.string())
        .optional()
        .describe(
          "Category slugs from list_wiki_articles. An article may sit in several.",
        ),
      component: z.string().optional(),
      sources: z
        .array(
          z.object({
            kind: z.enum(["entry", "doc"]),
            id: z.string(),
          }),
        )
        .optional()
        .describe(
          "What the article was composed from, so staleness can be detected later.",
        ),
      status: referenceStatusSchema.optional(),
      doc_version: z.string().optional(),
    },
  },
  async (a) => {
    const productId = a.product_slug
      ? await getProductIdBySlug(a.product_slug)
      : null;
    await requireCanEdit(productId ? { productId } : {});

    // Only "no such article" takes the create branch. Swallowing every error
    // meant a transient database failure inserted a second row at the same
    // slug, splitting the article's links and its history.
    const existing = await findArticle(productId, a.slug).catch((e) => {
      if (e instanceof AppError && e.code === "not_found") return null;
      throw e;
    });
    const actor = await mcpActor();
    const row = existing
      ? await updateReferenceDoc(
          existing.id as string,
          {
            title: a.title,
            body: a.body,
            status: a.status ?? "draft",
            ...(a.component !== undefined ? { component: a.component } : {}),
            ...(a.doc_version !== undefined
              ? { docVersion: a.doc_version }
              : {}),
          },
          actor,
        )
      : await saveReferenceDoc({
          productId,
          kind: "wiki",
          slug: a.slug,
          title: a.title,
          body: a.body,
          status: a.status ?? "draft",
          component: a.component,
          docVersion: a.doc_version,
          createdById: await resolveCurrentUserId(),
          actor,
        });

    if (a.categories)
      await setArticleCategories(productId, row.id, a.categories);
    if (a.sources?.length)
      await setComposedFrom(
        sql,
        row.id,
        a.sources.map((s) =>
          s.kind === "entry" ? { entryId: s.id } : { docId: s.id },
        ),
      );

    return out({
      saved: true,
      id: row.id,
      slug: a.slug,
      status: row.status,
      updated: !!existing,
      next: `The article is at /library/wiki/${a.product_slug ?? "general"}/${a.slug}. It is a ${row.status}; tell the user where it is rather than pasting it back.`,
    });
  },
);

tool(
  "save_reference_doc",
  {
    description:
      "Persist an APPROVED reference doc — freeform project context (docs, runbooks, architecture notes) that doesn't fit the issue→root_cause→resolution shape of a knowledge entry. The body is chunked and embedded so it surfaces in consult-mode search. Provide EITHER body (inline text) OR body_path (a local file — e.g. a large PDF — extracted server-side so the full text is saved without echoing it). Scope it with product_slug, and add component when the doc is about one part of that product (leave it off for general product docs). Pass doc_version when the source document carries a version label; pass supersedes with the id of the doc this replaces — the predecessor is archived and linked automatically, and search returns only the latest version. The call is gated by a review box the user can edit, so draft it and call rather than asking first.",
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
          "Set only when the doc describes ONE customer's install (their addon, their configuration). Leave it off for anything true of the product generally — a customer here means the doc is cited as that customer's setup, not as how the product works.",
        ),
      source: z
        .string()
        .optional()
        .describe(
          "Where the content came from — a URL (an ADO wiki page's remote_url), file path or origin note. Provenance, not a connection slug.",
        ),
      tags: z.array(z.string()).optional(),
      status: referenceStatusSchema.optional(),
      structured: structuredField,
      doc_version: z.string().optional(),
      supersedes: z.string().optional(),
      source_project_id: z
        .string()
        .optional()
        .describe("From get_ado_wiki_page — the project this page belongs to"),
      external_key: z
        .string()
        .optional()
        .describe(
          "The wiki page path. With source_project_id, re-importing the page supersedes the previous revision instead of duplicating it.",
        ),
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
      actor: await mcpActor(),
      source: a.source,
      sourceProjectId: a.source_project_id,
      externalKey: a.external_key,
      tags: a.tags,
      status: a.status ?? "approved",
      structured: a.structured,
      docVersion: a.doc_version,
      supersedes: a.supersedes,
      component: a.component,
      customerSlug: a.customer_slug,
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
      "List reference docs (newest first), optionally filtered by status, product_slug / team_slug, component, doc_version or tags. Bodies are omitted; use get_reference_doc for the full text. Rows carry doc_version and superseded_by — archived rows with superseded_by set are old versions of a newer doc.",
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
      "Update a reference doc, or change its status ('archived' to retire). Pass only the fields you want to change. If the body changes it is re-chunked and re-embedded. To publish a NEW VERSION of a doc, do not edit the body here — call save_reference_doc with supersedes instead. Pass expected_version (from list/get) to guard against concurrent edits.",
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
    if (a.customer_slug !== undefined) patch.customerSlug = a.customer_slug;
    if (a.expected_version !== undefined)
      patch.expectedVersion = a.expected_version;
    const row = await updateReferenceDoc(a.id, patch, await mcpActor());
    return out({
      updated: true,
      id: row.id,
      status: row.status,
      version: row.version,
    });
  },
);
