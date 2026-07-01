import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  saveKnowledgeEntry, searchKnowledge, updateKnowledgeEntry, getKnowledgeEntry, listKnowledgeEntries,
  addFeedback, listFeedback, recordRun,
  cloudSchema, resolutionClaritySchema, learningValueSchema,
} from "@tachy/core";
import type { RunInput } from "@tachy/core";

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
  cloud: cloudSchema.optional(),
  resolutionClarity: resolutionClaritySchema.optional(),
  learningValue: learningValueSchema.optional(),
  hiddenFix: z.boolean().optional(),
  structured: z.record(z.string(), z.any()).optional(),
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
  cloud: cloudSchema.nullable().optional(),
  resolutionClarity: resolutionClaritySchema.nullable().optional(),
  learningValue: learningValueSchema.nullable().optional(),
  hiddenFix: z.boolean().nullable().optional(),
  structured: z.record(z.string(), z.any()).optional(),
  expectedVersion: z.number().int().optional(),
});

const feedbackSchema = z.object({
  kind: z.enum(["correction", "rating", "note"]).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().optional(),
  patch: z.record(z.string(), z.any()).optional(),
});

const csv = (v: string | undefined) => v?.split(",").map((t) => t.trim()).filter(Boolean);

// Chained so `typeof knowledge` carries the route types for an RPC client.
export const knowledge = new Hono()
  .get("/search", async (c) => {
    const tags = csv(c.req.query("tags"));
    const rows = await searchKnowledge(c.req.query("q") ?? "", {
      productId: c.req.query("product_id"),
      teamId: c.req.query("team_id"),
      tags: tags?.length ? tags : undefined,
      cloud: c.req.query("cloud"),
      learningValue: c.req.query("learning_value"),
      resolutionClarity: c.req.query("resolution_clarity"),
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    });
    return c.json(rows);
  })
  .get("/:id/feedback", async (c) => c.json(await listFeedback(c.req.param("id"))))
  .post("/:id/feedback", zValidator("json", feedbackSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await addFeedback({ ...body, knowledgeEntryId: c.req.param("id") }));
  })
  .get("/:id", async (c) => c.json(await getKnowledgeEntry(c.req.param("id"))))
  .patch("/:id", zValidator("json", knowledgeUpdateSchema), async (c) => {
    return c.json(await updateKnowledgeEntry(c.req.param("id"), c.req.valid("json")));
  })
  .get("/", async (c) => {
    const tags = csv(c.req.query("tags"));
    const rows = await listKnowledgeEntries({
      status: c.req.query("status"),
      productId: c.req.query("product_id"),
      teamId: c.req.query("team_id"),
      tags: tags?.length ? tags : undefined,
      cloud: c.req.query("cloud"),
      learningValue: c.req.query("learning_value"),
      resolutionClarity: c.req.query("resolution_clarity"),
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    });
    return c.json(rows);
  })
  .post("/", zValidator("json", knowledgeInputSchema), async (c) => {
    return c.json(await saveKnowledgeEntry(c.req.valid("json")));
  });

const runSchema = z.object({
  mode: z.string(),
  workItemId: z.string().optional(),
  model: z.string().optional(),
  inputTokens: z.number().int().optional(),
  outputTokens: z.number().int().optional(),
  meta: z.record(z.string(), z.any()).optional(),
});

export const analysisRuns = new Hono().post("/", zValidator("json", runSchema), async (c) => {
  return c.json(await recordRun(c.req.valid("json") as RunInput));
});
