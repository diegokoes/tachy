import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  listResolutionPatterns, addResolutionPattern,
  listComponents, addComponent, getProductIdBySlug,
  listCustomers, addCustomer,
  listTeams, addTeam, listProducts, addProduct, listLabels, addLabel,
  listSourceConnections, addSourceConnection, listSourceProductMaps, addSourceProductMap,
  env, effectiveSettings, setSetting,
} from "@tachy/core";
import { requireAdmin } from "../auth";

const patternSchema = z.object({ slug: z.string(), description: z.string() });
const componentSchema = z.object({
  slug: z.string(), name: z.string(),
  parentSlug: z.string().optional(), description: z.string().optional(), aliases: z.array(z.string()).optional(),
});
const customerSchema = z.object({
  name: z.string(), slug: z.string(), aliases: z.array(z.string()).optional(), notes: z.string().optional(),
});
const teamSchema = z.object({ slug: z.string(), name: z.string() });
const productSchema = z.object({ team_slug: z.string(), slug: z.string(), name: z.string(), aliases: z.array(z.string()).optional() });
const sourceConnSchema = z.object({
  sourceType: z.string(), slug: z.string(), baseUrl: z.string().optional(), config: z.record(z.string(), z.any()).optional(),
});
const productMapSchema = z.object({ external_group_key: z.string(), product_slug: z.string() });
const labelSchema = z.object({ slug: z.string(), description: z.string().optional() });

// Org-structure + controlled-vocabulary endpoints. Mounted at "/" so each path is
// stated in full here. Chained for RPC type export.
export const admin = new Hono()
  // Reads are open to any authenticated user; mutations need the admin role.
  .use("*", async (c, next) => (c.req.method === "GET" ? next() : requireAdmin(c, next)))

  // Runtime settings (DB-backed, env as fallback) + read-only env facts.
  // Never expose secret VALUES here — only whether they are set.
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

  .put("/settings/:key", async (c) => {
    const { value } = await c.req.json<{ value: unknown }>();
    await setSetting(c.req.param("key"), value);
    return c.json({ settings: await effectiveSettings() });
  })
  .get("/resolution-patterns", async (c) => c.json(await listResolutionPatterns()))
  .post("/resolution-patterns", zValidator("json", patternSchema), async (c) => {
    const { slug, description } = c.req.valid("json");
    return c.json(await addResolutionPattern(slug, description));
  })
  .get("/products/:slug/components", async (c) => {
    return c.json(await listComponents(await getProductIdBySlug(c.req.param("slug"))));
  })
  .post("/products/:slug/components", zValidator("json", componentSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await addComponent({ ...body, productId: await getProductIdBySlug(c.req.param("slug")) }));
  })
  .get("/products/:slug/labels", async (c) => {
    return c.json(await listLabels(await getProductIdBySlug(c.req.param("slug"))));
  })
  .post("/products/:slug/labels", zValidator("json", labelSchema), async (c) => {
    const { slug, description } = c.req.valid("json");
    return c.json(await addLabel(await getProductIdBySlug(c.req.param("slug")), slug, description));
  })
  .get("/source-product-maps", async (c) => c.json(await listSourceProductMaps()))
  .get("/customers", async (c) => c.json(await listCustomers()))
  .post("/customers", zValidator("json", customerSchema), async (c) => c.json(await addCustomer(c.req.valid("json"))))
  .get("/teams", async (c) => c.json(await listTeams()))
  .post("/teams", zValidator("json", teamSchema), async (c) => {
    const { slug, name } = c.req.valid("json");
    return c.json(await addTeam(slug, name));
  })
  .get("/products", async (c) => c.json(await listProducts(c.req.query("team_slug"))))
  .post("/products", zValidator("json", productSchema), async (c) => {
    const { team_slug, slug, name, aliases } = c.req.valid("json");
    return c.json(await addProduct(team_slug, slug, name, aliases));
  })
  .get("/source-connections", async (c) => c.json(await listSourceConnections()))
  .post("/source-connections", zValidator("json", sourceConnSchema), async (c) => {
    return c.json(await addSourceConnection(c.req.valid("json")));
  })
  .get("/source-connections/:slug/product-map", async (c) => {
    return c.json(await listSourceProductMaps(c.req.param("slug")));
  })
  .post("/source-connections/:slug/product-map", zValidator("json", productMapSchema), async (c) => {
    const { external_group_key, product_slug } = c.req.valid("json");
    return c.json(await addSourceProductMap({
      sourceSlug: c.req.param("slug"), externalGroupKey: external_group_key, productSlug: product_slug,
    }));
  });
