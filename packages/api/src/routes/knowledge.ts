import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  saveKnowledgeEntry, searchKnowledge, updateKnowledgeEntry, getKnowledgeEntry, listKnowledgeEntries,
  listEnvironments, addFeedback, listFeedback, recordRun, sql, notFound, resolveComponentFilter,
  cloudSchema, resolutionClaritySchema, learningValueSchema,
  knowledgeStatusSchema, confidenceSchema, feedbackKindSchema, runModeSchema,
} from "@tachy/core";
import type { EntryScope, RunInput } from "@tachy/core";
import { assertScopeEditor, callerUserId } from "../authz";

const knowledgeInputSchema = z.object({
  workItemId: z.string().optional(),
  productId: z.string().optional(),
  teamId: z.string().optional(),
  status: knowledgeStatusSchema.optional(),
  issueSummary: z.string().optional(),
  symptoms: z.array(z.string()).optional(),
  signals: z.array(z.string()).optional(),
  rootCause: z.string().optional(),
  resolution: z.string().optional(),
  resolutionPattern: z.string().optional(),
  component: z.string().optional(),
  confidence: confidenceSchema.optional(),
  tags: z.array(z.string()).optional(),
  cloud: cloudSchema.optional(),
  resolutionClarity: resolutionClaritySchema.optional(),
  learningValue: learningValueSchema.optional(),
  hiddenFix: z.boolean().optional(),
  affectedVersion: z.string().optional(),
  fixedVersion: z.string().optional(),
  structured: z.record(z.string(), z.any()).optional(),
});

const knowledgeUpdateSchema = z.object({
  status: knowledgeStatusSchema.optional(),
  issueSummary: z.string().nullable().optional(),
  rootCause: z.string().nullable().optional(),
  resolution: z.string().nullable().optional(),
  resolutionPattern: z.string().nullable().optional(),
  symptoms: z.array(z.string()).optional(),
  signals: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  component: z.string().nullable().optional(),
  supersededBy: z.string().nullable().optional(),
  confidence: confidenceSchema.nullable().optional(),
  cloud: cloudSchema.nullable().optional(),
  resolutionClarity: resolutionClaritySchema.nullable().optional(),
  learningValue: learningValueSchema.nullable().optional(),
  hiddenFix: z.boolean().nullable().optional(),
  affectedVersion: z.string().nullable().optional(),
  fixedVersion: z.string().nullable().optional(),
  structured: z.record(z.string(), z.any()).optional(),
  expectedVersion: z.number().int().optional(),
});

const feedbackSchema = z.object({
  kind: feedbackKindSchema.optional(),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().optional(),
  patch: z.record(z.string(), z.any()).optional(),
});

const csv = (v: string | undefined) => v?.split(",").map((t) => t.trim()).filter(Boolean);

// component=<slug-or-alias> narrows to a component within ?product_id (FK link
// or legacy tag match); without product_id it is ignored, mirroring MCP.
async function componentFilter(c: { req: { query(k: string): string | undefined } }, tags: string[] | undefined) {
  const component = c.req.query("component");
  const productId = c.req.query("product_id");
  if (!component || !productId) return { tags: tags?.length ? tags : undefined };
  const f = await resolveComponentFilter(productId, component);
  const merged = [...(tags ?? []), ...(f.extraTags ?? [])];
  return {
    tags: merged.length ? merged : undefined,
    componentId: f.componentId,
    componentTags: f.componentTags,
  };
}

// Scope of a new entry for authorization: explicit product/team ids win; a
// work-item-only save inherits the item's scope (mirrors saveKnowledgeEntry).
async function newEntryScope(body: { workItemId?: string; productId?: string; teamId?: string }): Promise<EntryScope> {
  if (body.productId || body.teamId) return { productId: body.productId, teamId: body.teamId };
  if (body.workItemId) {
    const [wi] = await sql`select product_id, team_id from work_items where id = ${body.workItemId}`;
    if (wi) return { productId: wi.product_id, teamId: wi.team_id };
  }
  return {};
}

// Chained so `typeof knowledge` carries the route types for an RPC client.
export const knowledge = new Hono()
  .get("/search", async (c) => {
    const rows = await searchKnowledge(c.req.query("q") ?? "", {
      productId: c.req.query("product_id"),
      teamId: c.req.query("team_id"),
      ...(await componentFilter(c, csv(c.req.query("tags")))),
      cloud: c.req.query("cloud"),
      learningValue: c.req.query("learning_value"),
      resolutionClarity: c.req.query("resolution_clarity"),
      affectedVersion: c.req.query("affected_version"),
      fixedVersion: c.req.query("fixed_version"),
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    });
    return c.json(rows);
  })
  // Distinct observed environments with usage counts — feeds the UI filter
  // dropdown. Registered before "/:id" so it isn't captured as an id.
  .get("/environments", async (c) => c.json(await listEnvironments()))
  .get("/:id/feedback", async (c) => c.json(await listFeedback(c.req.param("id"))))
  .post("/:id/feedback", zValidator("json", feedbackSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await addFeedback({
      ...body,
      knowledgeEntryId: c.req.param("id"),
      userId: await callerUserId(c),
    }));
  })
  .get("/:id", async (c) => c.json(await getKnowledgeEntry(c.req.param("id"))))
  .patch("/:id", zValidator("json", knowledgeUpdateSchema), async (c) => {
    const id = c.req.param("id");
    const [row] = await sql`select product_id, team_id from knowledge_entries where id = ${id}`;
    if (!row) throw notFound(`knowledge entry ${id} not found`);
    await assertScopeEditor(c, { productId: row.product_id, teamId: row.team_id });
    return c.json(await updateKnowledgeEntry(id, c.req.valid("json")));
  })
  .get("/", async (c) => {
    const rows = await listKnowledgeEntries({
      status: c.req.query("status"),
      productId: c.req.query("product_id"),
      teamId: c.req.query("team_id"),
      ...(await componentFilter(c, csv(c.req.query("tags")))),
      cloud: c.req.query("cloud"),
      learningValue: c.req.query("learning_value"),
      resolutionClarity: c.req.query("resolution_clarity"),
      affectedVersion: c.req.query("affected_version"),
      fixedVersion: c.req.query("fixed_version"),
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    });
    return c.json(rows);
  })
  .post("/", zValidator("json", knowledgeInputSchema), async (c) => {
    const body = c.req.valid("json");
    await assertScopeEditor(c, await newEntryScope(body));
    return c.json(await saveKnowledgeEntry({ ...body, createdById: await callerUserId(c) }));
  });

const runSchema = z.object({
  mode: runModeSchema,
  workItemId: z.string().optional(),
  model: z.string().optional(),
  inputTokens: z.number().int().optional(),
  outputTokens: z.number().int().optional(),
  meta: z.record(z.string(), z.any()).optional(),
});

export const analysisRuns = new Hono().post("/", zValidator("json", runSchema), async (c) => {
  return c.json(await recordRun(c.req.valid("json") as RunInput));
});
