import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  listResolutionPatterns,
  addResolutionPattern,
  deleteResolutionPattern,
  resolutionPatternRenameImpact,
  renameResolutionPattern,
  listComponents,
  listComponentTree,
  addComponent,
  updateComponent,
  deleteComponent,
  getProductIdBySlug,
  componentRenameImpact,
  renameComponent,
  listTeams,
  addTeam,
  updateTeam,
  deleteTeam,
  listProducts,
  addProduct,
  updateProduct,
  deleteProduct,
  listLabels,
  addLabel,
  updateLabel,
  deleteLabel,
  labelRenameImpact,
  renameLabel,
  CATALOG_SLUG_RE,
  CATALOG_SLUG_HINT,
} from "@tachy/core";
import { requireAdmin } from "../../auth";
import {
  assertAnyTeamAdminApi,
  assertScopeEditor,
  assertTeamAdmin,
} from "../../authz";

export const slugField = z.string().regex(CATALOG_SLUG_RE, CATALOG_SLUG_HINT);

const patternSchema = z.object({ slug: slugField, description: z.string() });

const componentSchema = z.object({
  slug: slugField,
  name: z.string(),
  parentSlug: z.string().optional(),
  description: z.string().optional(),
  aliases: z.array(z.string()).optional(),
});

const teamSchema = z.object({ slug: slugField, name: z.string() });

const productSchema = z.object({
  team_slug: slugField,
  slug: slugField,
  name: z.string(),
  aliases: z.array(z.string()).optional(),
});

const labelSchema = z.object({
  slug: slugField,
  description: z.string().optional(),
});

const renameSchema = z.object({ to: slugField });

const componentPatchSchema = z.object({
  name: z.string().optional(),
  parentSlug: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  aliases: z.array(z.string()).optional(),
});

const teamPatchSchema = z.object({
  name: z.string().optional(),
  slug: slugField.optional(),
});

const productPatchSchema = z.object({
  name: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  slug: slugField.optional(),
  team_slug: slugField.optional(),
});

const labelPatchSchema = z.object({ description: z.string().nullable() });

const patternPatchSchema = z.object({ description: z.string() });

/** Teams, products and the vocabularies filed under them. */
export const catalog = new Hono()
  .get("/resolution-patterns", async (c) =>
    c.json(await listResolutionPatterns()),
  )
  .post(
    "/resolution-patterns",
    zValidator("json", patternSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const { slug, description } = c.req.valid("json");
      return c.json(await addResolutionPattern(slug, description));
    },
  )
  .patch(
    "/resolution-patterns/:slug",
    zValidator("json", patternPatchSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      return c.json(
        await addResolutionPattern(
          c.req.param("slug"),
          c.req.valid("json").description,
        ),
      );
    },
  )
  .delete("/resolution-patterns/:slug", async (c) => {
    await assertAnyTeamAdminApi(c);
    return c.json(await deleteResolutionPattern(c.req.param("slug")));
  })
  .get("/resolution-patterns/:slug/rename-impact", async (c) => {
    await assertAnyTeamAdminApi(c);
    return c.json(await resolutionPatternRenameImpact(c.req.param("slug")));
  })
  .post(
    "/resolution-patterns/:slug/rename",
    zValidator("json", renameSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      return c.json(
        await renameResolutionPattern(
          c.req.param("slug"),
          c.req.valid("json").to,
        ),
      );
    },
  )
  /* Every component at once, for the architecture view. Read-only and
     unscoped: the catalogue's shape is not a secret from anyone who can
     already list the products it hangs off. */
  .get("/components", async (c) => c.json(await listComponentTree()))
  .get("/products/:slug/components", async (c) => {
    return c.json(
      await listComponents(await getProductIdBySlug(c.req.param("slug"))),
    );
  })
  .post(
    "/products/:slug/components",
    zValidator("json", componentSchema),
    async (c) => {
      const body = c.req.valid("json");
      const productId = await getProductIdBySlug(c.req.param("slug"));
      await assertScopeEditor(c, { productId });
      return c.json(await addComponent({ ...body, productId }));
    },
  )
  .patch(
    "/products/:slug/components/:componentSlug",
    zValidator("json", componentPatchSchema),
    async (c) => {
      const productId = await getProductIdBySlug(c.req.param("slug"));
      await assertScopeEditor(c, { productId });
      return c.json(
        await updateComponent(
          productId,
          c.req.param("componentSlug"),
          c.req.valid("json"),
        ),
      );
    },
  )
  .delete("/products/:slug/components/:componentSlug", async (c) => {
    const productId = await getProductIdBySlug(c.req.param("slug"));
    await assertScopeEditor(c, { productId });
    return c.json(
      await deleteComponent(productId, c.req.param("componentSlug")),
    );
  })
  .get("/products/:slug/components/:componentSlug/rename-impact", async (c) => {
    const productId = await getProductIdBySlug(c.req.param("slug"));
    await assertScopeEditor(c, { productId });
    return c.json(
      await componentRenameImpact(productId, c.req.param("componentSlug")),
    );
  })
  .post(
    "/products/:slug/components/:componentSlug/rename",
    zValidator("json", renameSchema),
    async (c) => {
      const productId = await getProductIdBySlug(c.req.param("slug"));
      await assertScopeEditor(c, { productId });
      return c.json(
        await renameComponent(
          productId,
          c.req.param("componentSlug"),
          c.req.valid("json").to,
        ),
      );
    },
  )
  .get("/products/:slug/labels", async (c) => {
    return c.json(
      await listLabels(await getProductIdBySlug(c.req.param("slug"))),
    );
  })
  .post(
    "/products/:slug/labels",
    zValidator("json", labelSchema),
    async (c) => {
      const { slug, description } = c.req.valid("json");
      const productId = await getProductIdBySlug(c.req.param("slug"));
      await assertScopeEditor(c, { productId });
      return c.json(await addLabel(productId, slug, description));
    },
  )
  .patch(
    "/products/:slug/labels/:labelSlug",
    zValidator("json", labelPatchSchema),
    async (c) => {
      const productId = await getProductIdBySlug(c.req.param("slug"));
      await assertScopeEditor(c, { productId });
      return c.json(
        await updateLabel(
          productId,
          c.req.param("labelSlug"),
          c.req.valid("json").description,
        ),
      );
    },
  )
  .delete("/products/:slug/labels/:labelSlug", async (c) => {
    const productId = await getProductIdBySlug(c.req.param("slug"));
    await assertScopeEditor(c, { productId });
    return c.json(await deleteLabel(productId, c.req.param("labelSlug")));
  })
  .get("/products/:slug/labels/:labelSlug/rename-impact", async (c) => {
    const productId = await getProductIdBySlug(c.req.param("slug"));
    await assertScopeEditor(c, { productId });
    return c.json(await labelRenameImpact(productId, c.req.param("labelSlug")));
  })
  .post(
    "/products/:slug/labels/:labelSlug/rename",
    zValidator("json", renameSchema),
    async (c) => {
      const productId = await getProductIdBySlug(c.req.param("slug"));
      await assertScopeEditor(c, { productId });
      return c.json(
        await renameLabel(
          productId,
          c.req.param("labelSlug"),
          c.req.valid("json").to,
        ),
      );
    },
  )
  .get("/teams", async (c) => c.json(await listTeams()))
  .post("/teams", requireAdmin, zValidator("json", teamSchema), async (c) => {
    const { slug, name } = c.req.valid("json");
    return c.json(await addTeam(slug, name));
  })
  .patch(
    "/teams/:slug",
    requireAdmin,
    zValidator("json", teamPatchSchema),
    async (c) => {
      return c.json(
        await updateTeam(c.req.param("slug")!, c.req.valid("json")),
      );
    },
  )
  .delete("/teams/:slug", requireAdmin, async (c) => {
    return c.json(await deleteTeam(c.req.param("slug")!));
  })
  .get("/products", async (c) =>
    c.json(await listProducts(c.req.query("team_slug"))),
  )
  .post("/products", zValidator("json", productSchema), async (c) => {
    const { team_slug, slug, name, aliases } = c.req.valid("json");
    await assertTeamAdmin(c, team_slug);
    return c.json(await addProduct(team_slug, slug, name, aliases));
  })
  .patch(
    "/products/:slug",
    zValidator("json", productPatchSchema),
    async (c) => {
      const productId = await getProductIdBySlug(c.req.param("slug"));
      await assertScopeEditor(c, { productId });
      const b = c.req.valid("json");
      // Moving a product needs rights on the team it lands in, too.
      if (b.team_slug) await assertTeamAdmin(c, b.team_slug);
      return c.json(
        await updateProduct(productId, {
          name: b.name,
          aliases: b.aliases,
          slug: b.slug,
          teamSlug: b.team_slug,
        }),
      );
    },
  )
  .delete("/products/:slug", async (c) => {
    const productId = await getProductIdBySlug(c.req.param("slug"));
    await assertScopeEditor(c, { productId });
    return c.json(await deleteProduct(productId));
  });
