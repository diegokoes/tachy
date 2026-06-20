import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { serve } from "@hono/node-server";
import {
  registerSource, resolveSource, ingestWorkItem, saveKnowledgeEntry, searchKnowledge,
  addFeedback, listFeedback, recordRun, env,
} from "@tachy/core";
import type { KnowledgeInput, FeedbackInput, RunInput } from "@tachy/core";
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
  return c.json({ work_item_id: item.id, item: raw });
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
