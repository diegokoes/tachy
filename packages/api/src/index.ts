import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
  registerSource, resolveSource, ingestWorkItem, saveKnowledgeEntry, searchKnowledge, env,
} from "@tachy/core";
import type { KnowledgeInput } from "@tachy/core";
import { createFreshdeskSource } from "@tachy/source-freshdesk";

registerSource("freshdesk", createFreshdeskSource);

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/work-items/:source/:id/fetch", async (c) => {
  const { source, id } = c.req.param();
  const { conn, source: src } = await resolveSource(source);
  const raw = await src.fetchItem(id);
  const item = await ingestWorkItem(conn.id, raw);
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

// Persist an approved entry (body is a KnowledgeInput, camelCase).
app.post("/knowledge", async (c) => {
  const body = (await c.req.json()) as KnowledgeInput;
  const row = await saveKnowledgeEntry(body);
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

serve({ fetch: app.fetch, port: env.port });
console.log(`tachy api listening on :${env.port}`);
