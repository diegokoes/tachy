import { z } from "zod";
import {
  resolveCurrentUserId,
  sql,
  getProductIdBySlug,
  saveReferenceDoc,
  updateReferenceDoc,
  AppError,
  referenceStatusSchema,
  draftSources,
  wikiToc,
  findArticle,
  setArticleCategories,
  setComposedFrom,
  addWikiCategory,
  seedSectionsFromComponents,
  listWikiGaps,
} from "@tachy/core";
import { tool } from "../server";
import { out, outScrubbed } from "../results";
import { mcpActor, requireCanEdit } from "../permissions";

/** Wiki articles: what to draft them from, where they are filed, and what is still unwritten. */

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
  "list_wiki_gaps",
  {
    description:
      "What one wiki is missing, as the hourly sweep last found it, most pressing first. `unwritten`: a component with recorded lessons and no article (evidence.component is the slug to pass to draft_wiki_page). `outgrown`: an article whose component has gained uncited lessons since it was written (evidence.slug is the article to refresh). `stale`: an article whose sources changed. `wanted`: a [[link]] to an article nobody has written. `draft` and `uncategorised` are housekeeping. Omit product_slug for the org-wide wiki.",
    inputSchema: { product_slug: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  async (a) => {
    const productId = a.product_slug
      ? await getProductIdBySlug(a.product_slug)
      : null;
    const gaps = await listWikiGaps(productId);
    return out({
      gaps: gaps.map(({ kind, subject, score, evidence, first_seen_at }) => ({
        kind,
        subject,
        score,
        evidence,
        first_seen_at,
      })),
      ...(gaps.length
        ? {}
        : {
            note: "Nothing flagged. Say so rather than choosing a topic yourself.",
          }),
    });
  },
);

tool(
  "add_wiki_category",
  {
    description:
      "Add (or update) a category in one wiki's table of contents — the tree a reader navigates by, distinct from the product's components. Call it when an article you are saving fits no existing category from list_wiki_articles; nest it with parent rather than widening the top level. The review box is where the user refuses a category they do not want.",
    inputSchema: {
      product_slug: z
        .string()
        .optional()
        .describe("Omit for the org-wide wiki."),
      slug: z.string().describe("kebab-case, unique within this wiki"),
      name: z.string(),
      parent: z
        .string()
        .optional()
        .describe("Slug of the category to nest this one under."),
      description: z.string().optional(),
      lead: z
        .string()
        .optional()
        .describe(
          "Slug of the article that is this section's lead page — the all-encompassing page a reader lands on, whose headings enumerate the sub-topics. Omit to leave the section as a plain list of its articles.",
        ),
      components: z
        .array(z.string())
        .optional()
        .describe(
          "Component slugs this section covers, for per-section coverage and gaps. A section may bundle several. Omit to leave the section purely editorial.",
        ),
    },
  },
  async (a) => {
    const productId = a.product_slug
      ? await getProductIdBySlug(a.product_slug)
      : null;
    await requireCanEdit(productId ? { productId } : {});
    return out(
      await addWikiCategory({
        productId,
        slug: a.slug,
        name: a.name,
        parentSlug: a.parent ?? null,
        description: a.description ?? null,
        leadSlug: a.lead ?? null,
        componentSlugs: a.components,
      }),
    );
  },
);

tool(
  "seed_wiki_sections",
  {
    description:
      "Bootstrap a product wiki's top-level sections from its component tree: one section per top-level component, linked to it so per-section coverage works out of the box. The starting point for a new wiki — run it once, then rename, merge or add sections freely. Re-runnable: a section whose slug already exists is left untouched, so it never clobbers curation. No effect on the org-wide wiki, which has no components.",
    inputSchema: {
      product_slug: z
        .string()
        .describe("The product whose components seed the sections."),
    },
  },
  async (a) => {
    const productId = await getProductIdBySlug(a.product_slug);
    await requireCanEdit({ productId });
    const { created } = await seedSectionsFromComponents(productId);
    return out({
      created,
      note: created.length
        ? `Seeded ${created.length} section(s). Give each a lead article and refine as needed.`
        : "Every top-level component already has a section; nothing to add.",
    });
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
          "Category slugs from list_wiki_articles, or one you created first with add_wiki_category. An article may sit in several.",
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
      next: `The article is at /wiki/${a.product_slug ?? "general"}/${a.slug}. It is a ${row.status}; tell the user where it is rather than pasting it back.`,
    });
  },
);
