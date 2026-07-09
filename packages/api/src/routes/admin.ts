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
  addComponent,
  updateComponent,
  deleteComponent,
  getProductIdBySlug,
  componentRenameImpact,
  renameComponent,
  listCustomers,
  addCustomer,
  updateCustomer,
  deleteCustomer,
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
  listSourceConnections,
  addSourceConnection,
  listSourceProductMaps,
  addSourceProductMap,
  deleteSourceProductMap,
  env,
  effectiveSettings,
  setSetting,
} from "@tachy/core";
import { requireAdmin } from "../auth";
import {
  assertAnyTeamAdminApi,
  assertScopeEditor,
  assertTeamAdmin,
} from "../authz";

const patternSchema = z.object({ slug: z.string(), description: z.string() });
const componentSchema = z.object({
  slug: z.string(),
  name: z.string(),
  parentSlug: z.string().optional(),
  description: z.string().optional(),
  aliases: z.array(z.string()).optional(),
});
const customerSchema = z.object({
  name: z.string(),
  slug: z.string(),
  aliases: z.array(z.string()).optional(),
  notes: z.string().optional(),
});
const teamSchema = z.object({ slug: z.string(), name: z.string() });
const productSchema = z.object({
  team_slug: z.string(),
  slug: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).optional(),
});
const sourceConnSchema = z.object({
  sourceType: z.string(),
  slug: z.string(),
  baseUrl: z.string().optional(),
  config: z.record(z.string(), z.any()).optional(),
});
const productMapSchema = z.object({
  external_group_key: z.string(),
  product_slug: z.string(),
});
const labelSchema = z.object({
  slug: z.string(),
  description: z.string().optional(),
});

const slugField = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9._/-]*$/,
    "slug must be lowercase (letters, digits, . _ / -)",
  );

const renameSchema = z.object({ to: slugField });

const customerPatchSchema = z.object({
  name: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
});
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
});
const labelPatchSchema = z.object({ description: z.string().nullable() });
const patternPatchSchema = z.object({ description: z.string() });

export const admin = new Hono()

  .get("/system", async (c) =>
    c.json({
      settings: await effectiveSettings(),
      env: {
        auth_mode: env.authMode,
        port: env.port,
        user_email: env.userEmail ?? null,
        oidc_configured: Boolean(env.oidc),
        api_token_set: Boolean(env.apiToken),
        session_secret_set: Boolean(env.sessionSecret),
        anthropic_api_key_set: Boolean(process.env.ANTHROPIC_API_KEY),
        upload_dir: process.env.TACHY_UPLOAD_DIR || null,
      },
    }),
  )

  .put("/settings/:key", requireAdmin, async (c) => {
    const { value } = await c.req.json<{ value: unknown }>();

    await setSetting(c.req.param("key")!, value);
    return c.json({ settings: await effectiveSettings() });
  })
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
  .get("/source-product-maps", async (c) =>
    c.json(await listSourceProductMaps()),
  )
  .get("/customers", async (c) => c.json(await listCustomers()))
  .post("/customers", zValidator("json", customerSchema), async (c) => {
    await assertAnyTeamAdminApi(c);
    return c.json(await addCustomer(c.req.valid("json")));
  })
  .patch(
    "/customers/:slug",
    zValidator("json", customerPatchSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      return c.json(
        await updateCustomer(c.req.param("slug"), c.req.valid("json")),
      );
    },
  )
  .delete("/customers/:slug", async (c) => {
    await assertAnyTeamAdminApi(c);
    return c.json(await deleteCustomer(c.req.param("slug")));
  })
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
      return c.json(await updateProduct(productId, c.req.valid("json")));
    },
  )
  .delete("/products/:slug", async (c) => {
    const productId = await getProductIdBySlug(c.req.param("slug"));
    await assertScopeEditor(c, { productId });
    return c.json(await deleteProduct(productId));
  })
  .delete("/source-product-maps/:id", requireAdmin, async (c) => {
    return c.json(await deleteSourceProductMap(c.req.param("id")!));
  })
  .get("/source-connections", async (c) =>
    c.json(await listSourceConnections()),
  )
  .post(
    "/source-connections",
    requireAdmin,
    zValidator("json", sourceConnSchema),
    async (c) => {
      return c.json(await addSourceConnection(c.req.valid("json")));
    },
  )
  .get("/source-connections/:slug/product-map", async (c) => {
    return c.json(await listSourceProductMaps(c.req.param("slug")));
  })
  .post(
    "/source-connections/:slug/product-map",
    requireAdmin,
    zValidator("json", productMapSchema),
    async (c) => {
      const { external_group_key, product_slug } = c.req.valid("json");
      return c.json(
        await addSourceProductMap({
          sourceSlug: c.req.param("slug"),
          externalGroupKey: external_group_key,
          productSlug: product_slug,
        }),
      );
    },
  );
