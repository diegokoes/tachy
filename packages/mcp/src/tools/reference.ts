/** Reference docs, and the freeform context they are drafted from. */
import { z } from "zod";
import { resolveCurrentUserId } from "@tachy/core/access";
import { getCustomerIdBySlug } from "@tachy/core/catalog";
import {
  TokenMap,
  globalImagesAllowed,
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
  queueDocExtraction,
} from "@tachy/core/reference";
import { badInput } from "@tachy/core/infra";
import {
  imageForModel,
  type ExtractedFile,
  type ModelImage,
  type StoredFile,
} from "@tachy/core/files";
import { referenceStatusSchema } from "@tachy/core/knowledge";
import type { ReferenceDocUpdate } from "@tachy/core/reference";
import { extractSource } from "../extract";
import { tool } from "../server";
import {
  GRADE_NOTE,
  IMAGE_WITHHELD,
  PLACEHOLDER_NOTE,
  out,
  outScrubbed,
  outWithImages,
  pageFacts,
  searchOut,
  shownText,
} from "../results";
import { mcpActor, requireCanEdit, referenceDocScope } from "../permissions";
import { memberField, structuredField, textWindowFields } from "../fields";
import {
  componentIntoFilter,
  resolveScopeIds,
  loadContextSources,
  type ContextSource,
} from "../context";

/** What `ingest_context` returns of each source when `max_chars` is not given. */
const DEFAULT_PREVIEW_CHARS = 20_000;

/** What to do next with one source: open an archive, or read on. */
function sourceNote(
  source: ContextSource,
  continueAt: number | undefined,
): { note?: string } {
  if (source.members)
    return { note: "This is the archive's file list. Read one with member." };
  if (continueAt == null) return {};
  return {
    note: `Truncated - continue with offset: ${continueAt}; to save the FULL text as a reference doc, call save_reference_doc with body_path.`,
  };
}

/**
 * An image source as its entry in the result. The picture itself is appended
 * to `images`, and the entry says which one it is.
 */
async function shownImage(
  source: ContextSource & { image: StoredFile },
  images: ModelImage[],
) {
  if (!(source.imagesAllowed ?? globalImagesAllowed()))
    return { source: source.source, note: IMAGE_WITHHELD };
  const image = await imageForModel(source.image.bytes);
  images.push(image);
  return {
    source: source.source,
    image: images.length,
    width_px: image.widthPx,
    height_px: image.heightPx,
    note: `Image ${images.length} of those that follow this result.`,
  };
}

const hasImage = (
  source: ContextSource,
): source is ContextSource & { image: StoredFile } => source.image != null;

tool(
  "ingest_context",
  {
    description:
      "Load freeform project context from pasted text, attached file paths, and/or URLs, and return the cleaned raw text for you to structure. PDF, Word, Excel and mail (.eml) files are read as text; an image comes back as the image itself; a zip answers with its file list, and member reads one of them. This tool ONLY reads - it never saves. Long sources are truncated at max_chars (default 20000): continue with offset, or narrow a log with match. For large documents (big PDFs), preview here, then call save_reference_doc with body_path so the full text is extracted and saved server-side. After loading, classify the content and route each part: durable incident lessons → save_knowledge_entry; architecture facts → add_component; everything else (docs, runbooks, design notes, config explainers) → save_reference_doc. Say briefly how you routed it, then make the calls - each is gated by its own review box.",
    inputSchema: {
      product_slug: z.string().optional(),
      team_slug: z.string().optional(),
      text: z.string().optional(),
      paths: z.array(z.string()).optional(),
      urls: z.array(z.string()).optional(),
      ...textWindowFields,
      member: memberField,
    },
    // readOnlyHint because nothing here is persisted; openWorldHint because
    // `urls` reaches hosts outside this deployment, which is what a client
    // deciding whether to run this unattended needs to weigh.
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({
    product_slug,
    team_slug,
    text,
    paths,
    urls,
    max_chars,
    offset,
    match,
    member,
  }) => {
    const sources = await loadContextSources({ text, paths, urls, member });
    if (!sources.length)
      throw badInput("Provide at least one of: text, paths, urls");

    const window = {
      offset,
      maxChars: max_chars ?? DEFAULT_PREVIEW_CHARS,
      match,
    };
    const tokens = new TokenMap();
    const images: ModelImage[] = [];
    const shownSources: Record<string, unknown>[] = [];
    for (const source of sources) {
      if (hasImage(source)) {
        shownSources.push(await shownImage(source, images));
        continue;
      }
      const shown = shownText(source.text, window, tokens, source.redact);
      shownSources.push({
        source: source.source,
        ...pageFacts(source),
        ...(source.members ? { members: source.members } : {}),
        ...shown,
        ...sourceNote(source, shown.continue_at),
      });
    }
    return outWithImages(
      {
        product_slug: product_slug ?? null,
        team_slug: team_slug ?? null,
        sources: shownSources,
        ...(globalRedactionEnabled() || sources.some((s) => s.redact)
          ? { redaction: PLACEHOLDER_NOTE }
          : {}),
        next: "Summarize how this routes, then call save_knowledge_entry / save_reference_doc / add_component. Each call is gated by its own review box.",
      },
      images,
    );
  },
);

/**
 * A doc saved from a PDF holds only its text layer. The rest, its figures and
 * the words of its scanned pages, is added by a job, and the result says so.
 */
async function pdfCompletion(
  docId: string,
  path: string | undefined,
  extracted: ExtractedFile | undefined,
  userId: string | null,
): Promise<Record<string, unknown>> {
  if (!path || extracted?.pages == null) return {};
  await queueDocExtraction({ docId, path, userId });
  return {
    completion: "queued",
    completion_note:
      "The doc holds the PDF's text pages now. A job is placing its figures and reading its scanned pages, and adds them as a new revision; tell the user in one line and do not wait for it.",
  };
}

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
    let extracted: (ExtractedFile & { redact: boolean }) | undefined;
    if (args.body_path) {
      extracted = await extractSource(args.body_path);
      if (extracted.members)
        throw badInput(
          "body_path names an archive, which is a list of files and not a document; attach the file itself",
        );
      body = extracted.redact
        ? scrubText(extracted.text, new TokenMap())
        : extracted.text;
    }
    const userId = await resolveCurrentUserId();
    const saved = await saveReferenceDoc({
      title: args.title,
      body: body!,
      productId,
      teamId,
      createdById: userId,
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
      ...pageFacts(extracted ?? {}),
      ...(await pdfCompletion(saved.id, args.body_path, extracted, userId)),
    });
  },
);

tool(
  "search_reference",
  {
    description: `Semantic search over approved reference docs (project context). Returns the best-matching snippet per doc, with the page it is on when the doc came from a PDF: cite it. Only the latest approved version of a doc is returned. Filter by product_slug / team_slug (slug or alias) and tags. ${GRADE_NOTE}`,
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
