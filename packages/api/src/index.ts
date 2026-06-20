import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { serve } from "@hono/node-server";
import {
  registerSource, resolveSource, ingestWorkItem, saveKnowledgeEntry, searchKnowledge,
  addFeedback, listFeedback, recordRun, env,
  listResolutionPatterns, addResolutionPattern,
  listComponents, addComponent, getProductIdBySlug,
  listCustomers, addCustomer, getCustomerIdBySlug, setWorkItemCustomer, setObservedVersion, getCustomerName,
} from "@tachy/core";
import type { KnowledgeInput, FeedbackInput, RunInput, AddComponentInput, CustomerInput } from "@tachy/core";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";

registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

// Shared-bearer-token auth on everything except /health. With no token set the
// server also binds to localhost only (see serve() below) and warns loudly.
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

// Ranked prior approved entries only — drafts/rejected never surface here.
app.get("/knowledge/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  const rows = await searchKnowledge(q, {
    productId: c.req.query("product_id"),
    teamId: c.req.query("team_id"),
    limit,
  });
  return c.json(rows);
});

app.post("/knowledge", async (c) => {
  const body = (await c.req.json()) as KnowledgeInput;
  const row = await saveKnowledgeEntry(body);
  return c.json(row);
});

app.get("/knowledge/:id/feedback", async (c) => {
  return c.json(await listFeedback(c.req.param("id")));
});

app.post("/knowledge/:id/feedback", async (c) => {
  const body = (await c.req.json()) as Omit<FeedbackInput, "knowledgeEntryId">;
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

if (!env.apiToken) {
  console.warn(
    "WARNING: TACHY_API_TOKEN is not set. Binding to 127.0.0.1 only; set a token to accept remote requests.",
  );
}
serve({ fetch: app.fetch, port: env.port, hostname: env.apiToken ? undefined : "127.0.0.1" });
console.log(`tachy api listening on :${env.port}`);
