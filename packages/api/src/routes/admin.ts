import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  listResolutionPatterns, addResolutionPattern,
  listComponents, addComponent, getProductIdBySlug,
  listCustomers, addCustomer,
  listTeams, addTeam, listProducts, addProduct,
  listSourceConnections, addSourceConnection, listSourceProductMaps, addSourceProductMap,
} from "@tachy/core";

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

// Org-structure + controlled-vocabulary endpoints. Mounted at "/" so each path is
// stated in full here. Chained for RPC type export.
export const admin = new Hono()
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
