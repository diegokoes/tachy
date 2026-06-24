import { Hono } from "hono";
import type { Context } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { z } from "zod";
import {
  registerSource, resolveSource, ingestWorkItem, saveKnowledgeEntry, searchKnowledge,
  updateKnowledgeEntry, getKnowledgeEntry, listKnowledgeEntries,
  addFeedback, listFeedback, recordRun, env, sql,
  listResolutionPatterns, addResolutionPattern,
  listComponents, addComponent, getProductIdBySlug,
  listCustomers, addCustomer, getCustomerIdBySlug, setWorkItemCustomer, setObservedVersion, getCustomerName,
  listTeams, addTeam, listProducts, addProduct,
  listSourceConnections, addSourceConnection, listSourceProductMaps, addSourceProductMap,
} from "@tachy/core";
import type { RunInput, AddComponentInput, CustomerInput, SourceConnectionInput } from "@tachy/core";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";

registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);

const app = new Hono();

app.use("*", logger());

// Parse + validate a JSON body. A failure (bad JSON or schema mismatch) throws and
// is turned into a 400 by app.onError below, instead of a silent 500 / crash.
const readJson = async <T>(c: Context, schema: z.ZodType<T>): Promise<T> => schema.parse(await c.req.json());

const knowledgeInputSchema = z.object({
  workItemId: z.string().optional(),
  productId: z.string().optional(),
  teamId: z.string().optional(),
  status: z.string().optional(),
  issueSummary: z.string().optional(),
  symptoms: z.array(z.string()).optional(),
  signals: z.array(z.string()).optional(),
  rootCause: z.string().optional(),
  resolution: z.string().optional(),
  resolutionPattern: z.string().optional(),
  productArea: z.string().optional(),
  confidence: z.string().optional(),
  tags: z.array(z.string()).optional(),
  structured: z.record(z.any()).optional(),
});

const knowledgeUpdateSchema = z.object({
  status: z.string().optional(),
  issueSummary: z.string().nullable().optional(),
  rootCause: z.string().nullable().optional(),
  resolution: z.string().nullable().optional(),
  resolutionPattern: z.string().nullable().optional(),
  symptoms: z.array(z.string()).optional(),
  signals: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  productArea: z.string().nullable().optional(),
  confidence: z.string().nullable().optional(),
  structured: z.record(z.any()).optional(),
  expectedVersion: z.number().int().optional(),
});

const feedbackSchema = z.object({
  kind: z.enum(["correction", "rating", "note"]).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().optional(),
  patch: z.record(z.any()).optional(),
});

app.get("/health", async (c) => {
  try {
    await sql`select 1`;
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false }, 503);
  }
});

// Bearer-token guard on all routes except /health. Without a token the server binds to localhost only.
if (env.apiToken) {
  const guard = bearerAuth({ token: env.apiToken });
  app.use("*", (c, next) => (c.req.path === "/health" ? next() : guard(c, next)));
}

app.post("/work-items/:source/:id/fetch", async (c) => {
  const { source, id } = c.req.param();
  const { conn, source: src } = await resolveSource(source);
  const raw = await src.fetchItem(id);
  const item = await ingestWorkItem(conn.id, raw);
  await recordRun({ workItemId: item.id, mode: "ingest" });
  const customerName = await getCustomerName(item.customerId);
  return c.json({
    work_item_id: item.id, product_id: item.productId, team_id: item.teamId,
    customer_id: item.customerId, customer_name: customerName, observed_version: item.observedVersion,
    item: raw,
  });
});

app.patch("/work-items/:id/customer", async (c) => {
  const { customer_slug } = (await c.req.json()) as { customer_slug: string | null };
  const customerId = customer_slug ? await getCustomerIdBySlug(customer_slug) : null;
  await setWorkItemCustomer(c.req.param("id"), customerId);
  return c.json({ updated: true, customer_id: customerId });
});

app.patch("/work-items/:id/observed-version", async (c) => {
  const { version } = (await c.req.json()) as { version: string | null };
  await setObservedVersion(c.req.param("id"), version);
  return c.json({ updated: true, observed_version: version });
});

app.get("/knowledge/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  const tags = c.req.query("tags")?.split(",").map((t) => t.trim()).filter(Boolean);
  const rows = await searchKnowledge(q, {
    productId: c.req.query("product_id"),
    teamId: c.req.query("team_id"),
    tags: tags?.length ? tags : undefined,
    limit,
  });
  return c.json(rows);
});

app.get("/knowledge/:id", async (c) => {
  return c.json(await getKnowledgeEntry(c.req.param("id")));
});

app.get("/knowledge", async (c) => {
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  const tags = c.req.query("tags")?.split(",").map((t) => t.trim()).filter(Boolean);
  const rows = await listKnowledgeEntries({
    status:    c.req.query("status"),
    productId: c.req.query("product_id"),
    teamId:    c.req.query("team_id"),
    tags:      tags?.length ? tags : undefined,
    limit,
  });
  return c.json(rows);
});

app.post("/knowledge", async (c) => {
  const body = await readJson(c, knowledgeInputSchema);
  const row = await saveKnowledgeEntry(body);
  return c.json(row);
});

app.patch("/knowledge/:id", async (c) => {
  const body = await readJson(c, knowledgeUpdateSchema);
  const row = await updateKnowledgeEntry(c.req.param("id"), body);
  return c.json(row);
});

app.get("/knowledge/:id/feedback", async (c) => {
  return c.json(await listFeedback(c.req.param("id")));
});

app.post("/knowledge/:id/feedback", async (c) => {
  const body = await readJson(c, feedbackSchema);
  const row = await addFeedback({ ...body, knowledgeEntryId: c.req.param("id") });
  return c.json(row);
});

app.post("/analysis-runs", async (c) => {
  const body = (await c.req.json()) as RunInput;
  const row = await recordRun(body);
  return c.json(row);
});

app.get("/resolution-patterns", async (c) => c.json(await listResolutionPatterns()));

app.post("/resolution-patterns", async (c) => {
  const { slug, description } = (await c.req.json()) as { slug: string; description: string };
  return c.json(await addResolutionPattern(slug, description));
});

app.get("/products/:slug/components", async (c) => {
  return c.json(await listComponents(await getProductIdBySlug(c.req.param("slug"))));
});

app.post("/products/:slug/components", async (c) => {
  const body = (await c.req.json()) as Omit<AddComponentInput, "productId">;
  const row = await addComponent({ ...body, productId: await getProductIdBySlug(c.req.param("slug")) });
  return c.json(row);
});

app.get("/customers", async (c) => c.json(await listCustomers()));

app.post("/customers", async (c) => {
  const body = (await c.req.json()) as CustomerInput;
  return c.json(await addCustomer(body));
});

app.post("/work-items/:source/:id/notes", async (c) => {
  const { source, id } = c.req.param();
  const { body } = (await c.req.json()) as { body: string };
  const { source: src } = await resolveSource(source);
  if (!src.postNote) return c.json({ error: "notes unsupported for this source" }, 400);
  await src.postNote(id, body, { private: true });
  return c.json({ posted: true });
});

app.get("/teams", async (c) => c.json(await listTeams()));

app.post("/teams", async (c) => {
  const { slug, name } = (await c.req.json()) as { slug: string; name: string };
  return c.json(await addTeam(slug, name));
});

app.get("/products", async (c) => c.json(await listProducts(c.req.query("team_slug"))));

app.post("/products", async (c) => {
  const { team_slug, slug, name } = (await c.req.json()) as { team_slug: string; slug: string; name: string };
  return c.json(await addProduct(team_slug, slug, name));
});

app.get("/source-connections", async (c) => c.json(await listSourceConnections()));

app.post("/source-connections", async (c) => {
  const body = (await c.req.json()) as SourceConnectionInput;
  return c.json(await addSourceConnection(body));
});

app.get("/source-connections/:slug/product-map", async (c) => {
  return c.json(await listSourceProductMaps(c.req.param("slug")));
});

app.post("/source-connections/:slug/product-map", async (c) => {
  const { external_group_key, product_slug } = (await c.req.json()) as { external_group_key: string; product_slug: string };
  return c.json(await addSourceProductMap({ sourceSlug: c.req.param("slug"), externalGroupKey: external_group_key, productSlug: product_slug }));
});

app.notFound((c) => c.json({ error: "not found" }, 404));

// Single error boundary: map known failure shapes to proper status codes instead
// of leaking a 500 (or crashing the process on an unhandled rejection).
app.onError((err, c) => {
  if (err instanceof z.ZodError) return c.json({ error: "validation failed", issues: err.issues }, 400);
  if (err instanceof SyntaxError) return c.json({ error: "invalid JSON body" }, 400);
  const msg = err instanceof Error ? err.message : String(err);
  if (/version conflict/i.test(msg)) return c.json({ error: msg }, 409);
  if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
  if (/^unknown /i.test(msg)) return c.json({ error: msg }, 400);
  console.error(msg);
  return c.json({ error: "internal error" }, 500);
});

if (!env.apiToken) {
  console.warn(
    "WARNING: TACHY_API_TOKEN is not set. Binding to 127.0.0.1 only; set a token to accept remote requests.",
  );
}
serve({ fetch: app.fetch, port: env.port, hostname: env.apiToken ? undefined : "127.0.0.1" });
console.log(`tachy api listening on :${env.port}`);
