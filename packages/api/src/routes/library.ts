import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  addWikiCategory,
  updateWikiCategory,
  deleteWikiCategory,
  listWikiCategories,
  wikiToc,
  articleCategories,
  setArticleCategories,
  findArticle,
  findMainPage,
  listWikis,
  coverage,
  articleStaleness,
  updateComponent,
  componentRenameImpact,
  saveReferenceDoc,
  updateReferenceDoc,
  countView,
  referenceStatusSchema,
  notFound,
  badInput,
  sql,
  saveAsset,
  getAsset,
  MAX_ASSET_BYTES,
  sweepWikiGaps,
  listWikiGaps,
  dismissWikiGap,
} from "@tachy/core";
import type { EntryScope } from "@tachy/core";
import { assertScopeEditor, callerActor, callerUserId } from "../authz";

/**
 * The scope segment is a product slug, or the literal 'general' for the
 * org-wide wiki. A product actually slugged 'general' wins, so an existing
 * product is never shadowed by the reserved word.
 */
const ORG_WIDE = "general";

async function scopeProductId(scope: string): Promise<string | null> {
  const [row] = await sql`select id from products where slug = ${scope}`;
  if (row) return row.id as string;
  if (scope === ORG_WIDE) return null;
  throw notFound(`No wiki for '${scope}' — unknown product`);
}

/** Writes are gated on the product the wiki belongs to; org-wide has no scope. */
const wikiScope = (productId: string | null): EntryScope =>
  productId ? { productId } : {};

/**
 * Re-find one wiki's gaps after an edit through here, so writing the article a
 * gap asked for clears it now rather than at the next hourly sweep. Awaited:
 * the SPA reloads the switcher's counts as soon as the save returns, and a
 * sweep still in flight would hand it the numbers from before the edit. One
 * wiki's worth of reads, and it logs rather than throws, so the edit it
 * follows cannot fail on its account.
 */
const rescan = async (productId: string | null) => {
  await sweepWikiGaps({ productId });
};

/** Multipart framing on top of the file itself; generous, it is only a guard. */
const UPLOAD_OVERHEAD = 64 * 1024;

const categorySchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  parentSlug: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  ordinal: z.number().int().optional(),
});

const categoryPatchSchema = z.object({
  slug: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  parentSlug: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  ordinal: z.number().int().optional(),
});

const componentPatchSchema = z.object({
  name: z.string().min(1).optional(),
  parentSlug: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

const articleSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  status: referenceStatusSchema.optional(),
  tags: z.array(z.string()).optional(),
  docVersion: z.string().nullable().optional(),
  component: z.string().nullable().optional(),
  customerSlug: z.string().nullable().optional(),
  categories: z.array(z.string()).optional(),
});

const articlePatchSchema = articleSchema.partial().extend({
  expectedVersion: z.number().int().optional(),
});

export const library = new Hono()
  .get("/wiki", async (c) => c.json(await listWikis()))

  // Served from this origin with everything but the image switched off, so an
  // asset opened directly in a tab is a picture and nothing more.
  .get("/assets/:id", async (c) => {
    const asset = await getAsset(c.req.param("id"));
    return c.body(new Uint8Array(asset.bytes), 200, {
      "Content-Type": asset.contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=31536000, immutable",
    });
  })

  .post("/wiki/:scope/assets", async (c) => {
    const productId = await scopeProductId(c.req.param("scope"));
    await assertScopeEditor(c, wikiScope(productId));
    // Checked before parseBody, which buffers the whole request first: past
    // that point the limit has already been paid for in memory.
    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > MAX_ASSET_BYTES + UPLOAD_OVERHEAD)
      throw badInput(
        `image too large (max ${MAX_ASSET_BYTES / 1024 / 1024} MB)`,
      );
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw badInput("expected a 'file' field");
    return c.json(
      await saveAsset({
        bytes: new Uint8Array(await file.arrayBuffer()),
        filename: file.name || null,
        productId,
        createdById: await callerUserId(c),
      }),
    );
  })

  // What the last sweep found missing, with the component tree it was measured
  // against. The org-wide wiki has no components, so only the list.
  .get("/wiki/:scope/gaps", async (c) => {
    const productId = await scopeProductId(c.req.param("scope"));
    const [gaps, tree] = await Promise.all([
      listWikiGaps(productId),
      productId ? coverage(productId) : Promise.resolve(null),
    ]);
    return c.json({ gaps, coverage: tree });
  })

  // Waits for a sweep already running rather than skipping, unlike the
  // background ones: whoever pressed this wants the answer as of now.
  .post("/wiki/:scope/gaps/rescan", async (c) => {
    const productId = await scopeProductId(c.req.param("scope"));
    await assertScopeEditor(c, wikiScope(productId));
    await sweepWikiGaps({ productId, wait: true });
    return c.json(await listWikiGaps(productId));
  })

  .post("/wiki/:scope/gaps/:id/dismiss", async (c) => {
    const productId = await scopeProductId(c.req.param("scope"));
    await assertScopeEditor(c, wikiScope(productId));
    return c.json(
      await dismissWikiGap(productId, c.req.param("id"), await callerUserId(c)),
    );
  })

  // A report, not the wiki's navigation: the component tree is what the product
  // is made of, and this asks which parts of it nobody has written about.
  .get("/wiki/:scope/coverage", async (c) => {
    const productId = await scopeProductId(c.req.param("scope"));
    if (!productId)
      throw badInput(
        "coverage is per product; the org-wide wiki has no components",
      );
    return c.json(await coverage(productId));
  })

  // Re-parenting from the coverage view, where the shape is actually visible.
  .patch(
    "/wiki/:scope/components/:slug",
    zValidator("json", componentPatchSchema),
    async (c) => {
      const productId = await scopeProductId(c.req.param("scope"));
      if (!productId) throw badInput("components belong to a product");
      await assertScopeEditor(c, { productId });
      const row = await updateComponent(
        productId,
        c.req.param("slug"),
        c.req.valid("json"),
      );
      // A move changes which part of the tree the gaps roll up under.
      await rescan(productId);
      return c.json(row);
    },
  )

  .get("/wiki/:scope/components/:slug/rename-impact", async (c) => {
    const productId = await scopeProductId(c.req.param("scope"));
    if (!productId) throw badInput("components belong to a product");
    return c.json(await componentRenameImpact(productId, c.req.param("slug")));
  })

  .get("/wiki/:scope/toc", async (c) =>
    c.json(await wikiToc(await scopeProductId(c.req.param("scope")))),
  )

  // Null rather than 404: a wiki with no main page yet is new, not missing, and
  // the UI offers to write one.
  .get("/wiki/:scope/main", async (c) =>
    c.json(await findMainPage(await scopeProductId(c.req.param("scope")))),
  )

  .get("/wiki/:scope/categories", async (c) =>
    c.json(
      await listWikiCategories(await scopeProductId(c.req.param("scope"))),
    ),
  )

  .post(
    "/wiki/:scope/categories",
    zValidator("json", categorySchema),
    async (c) => {
      const productId = await scopeProductId(c.req.param("scope"));
      await assertScopeEditor(c, wikiScope(productId));
      const row = await addWikiCategory({ ...c.req.valid("json"), productId });
      await rescan(productId);
      return c.json(row);
    },
  )

  .patch(
    "/wiki/:scope/categories/:slug",
    zValidator("json", categoryPatchSchema),
    async (c) => {
      const productId = await scopeProductId(c.req.param("scope"));
      await assertScopeEditor(c, wikiScope(productId));
      const row = await updateWikiCategory(
        productId,
        c.req.param("slug"),
        c.req.valid("json"),
      );
      await rescan(productId);
      return c.json(row);
    },
  )

  .delete("/wiki/:scope/categories/:slug", async (c) => {
    const productId = await scopeProductId(c.req.param("scope"));
    await assertScopeEditor(c, wikiScope(productId));
    const gone = await deleteWikiCategory(productId, c.req.param("slug"));
    await rescan(productId);
    return c.json(gone);
  })

  .post(
    "/wiki/:scope/articles",
    zValidator("json", articleSchema),
    async (c) => {
      const productId = await scopeProductId(c.req.param("scope"));
      await assertScopeEditor(c, wikiScope(productId));
      const { categories, ...body } = c.req.valid("json");
      const saved = await saveReferenceDoc({
        ...body,
        productId,
        kind: "wiki",
        createdById: await callerUserId(c),
        actor: await callerActor(c),
      });
      if (categories)
        await setArticleCategories(productId, saved.id, categories);
      await rescan(productId);
      return c.json(saved);
    },
  )

  .get("/wiki/:scope/articles/:slug", async (c) => {
    const productId = await scopeProductId(c.req.param("scope"));
    const doc = await findArticle(productId, c.req.param("slug"));
    // Not awaited: a read must not pay for its own bookkeeping.
    countView({ docId: doc.id as string }, await callerUserId(c));
    const [categories, built] = await Promise.all([
      articleCategories(doc.id as string),
      articleStaleness(doc.id as string),
    ]);
    return c.json({ ...doc, categories, built });
  })

  .patch(
    "/wiki/:scope/articles/:slug",
    zValidator("json", articlePatchSchema),
    async (c) => {
      const productId = await scopeProductId(c.req.param("scope"));
      await assertScopeEditor(c, wikiScope(productId));
      const current = await findArticle(productId, c.req.param("slug"));
      const { categories, ...patch } = c.req.valid("json");
      const row = await updateReferenceDoc(
        current.id as string,
        patch,
        await callerActor(c),
      );
      if (categories)
        await setArticleCategories(productId, current.id as string, categories);
      await rescan(productId);
      return c.json(row);
    },
  );

export { scopeProductId, ORG_WIDE };
