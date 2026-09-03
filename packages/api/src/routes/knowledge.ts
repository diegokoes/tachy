import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  saveKnowledgeEntry,
  searchKnowledge,
  updateKnowledgeEntry,
  revertKnowledgeEntry,
  listRevisions,
  getRevision,
  countView,
  backlinks,
  outboundLinks,
  viewStats,
  viewHistory,
  getKnowledgeEntry,
  listKnowledgeEntries,
  listEnvironments,
  listKnowledgeFacets,
  addFeedback,
  listFeedback,
  recordRun,
  sql,
  notFound,
  resolveComponentFilter,
  getCustomerIdBySlug,
  cloudSchema,
  resolutionClaritySchema,
  knowledgeStatusSchema,
  confidenceSchema,
  feedbackKindSchema,
  runModeSchema,
} from "@tachy/core";
import type { EntryScope, RunInput } from "@tachy/core";
import { assertScopeEditor, callerActor, callerUserId } from "../authz";
import { csv } from "../query";

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
  customerSlug: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  confidence: confidenceSchema.optional(),
  tags: z.array(z.string()).optional(),
  cloud: cloudSchema.optional(),
  resolutionClarity: resolutionClaritySchema.optional(),
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
  customerSlug: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  supersededBy: z.string().nullable().optional(),
  confidence: confidenceSchema.nullable().optional(),
  cloud: cloudSchema.nullable().optional(),
  resolutionClarity: resolutionClaritySchema.nullable().optional(),
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

type QueryCtx = { req: { query(k: string): string | undefined } };

/** `hidden_fix` is the one boolean facet — absent means "don't filter". */
function boolParam(v: string | undefined): boolean | undefined {
  return v === undefined || v === "" ? undefined : v === "true";
}

/** The library filters by slug; the query wants the id. */
async function customerFilter(c: QueryCtx) {
  const slug = c.req.query("customer");
  return slug ? { customerId: await getCustomerIdBySlug(slug) } : {};
}

async function listFilters(c: QueryCtx) {
  return {
    productId: c.req.query("product_id"),
    teamId: c.req.query("team_id"),
    ...(await componentFilter(c, csv(c.req.query("tags")))),
    ...(await customerFilter(c)),
    cloud: c.req.query("cloud"),
    confidence: c.req.query("confidence"),
    resolutionClarity: c.req.query("resolution_clarity"),
    resolutionPattern: c.req.query("resolution_pattern"),
    hiddenFix: boolParam(c.req.query("hidden_fix")),
    affectedVersion: c.req.query("affected_version"),
    fixedVersion: c.req.query("fixed_version"),
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
  };
}

async function componentFilter(c: QueryCtx, tags: string[] | undefined) {
  const component = c.req.query("component");
  const productId = c.req.query("product_id");
  if (!component || !productId)
    return { tags: tags?.length ? tags : undefined };
  const f = await resolveComponentFilter(productId, component);
  const merged = [...(tags ?? []), ...(f.extraTags ?? [])];
  return {
    tags: merged.length ? merged : undefined,
    componentId: f.componentId,
    componentTags: f.componentTags,
  };
}

async function newEntryScope(body: {
  workItemId?: string;
  productId?: string;
  teamId?: string;
}): Promise<EntryScope> {
  if (body.productId || body.teamId)
    return { productId: body.productId, teamId: body.teamId };
  if (body.workItemId) {
    const [wi] =
      await sql`select product_id, team_id from work_items where id = ${body.workItemId}`;
    if (wi) return { productId: wi.product_id, teamId: wi.team_id };
  }
  return {};
}

async function entryScope(id: string): Promise<EntryScope> {
  const [row] =
    await sql`select product_id, team_id from knowledge_entries where id = ${id}`;
  if (!row) throw notFound(`knowledge entry ${id} not found`);
  return { productId: row.product_id, teamId: row.team_id };
}

export const knowledge = new Hono()
  .get("/search", async (c) => {
    const rows = await searchKnowledge(
      c.req.query("q") ?? "",
      await listFilters(c),
    );
    return c.json(rows);
  })

  .get("/environments", async (c) => c.json(await listEnvironments()))
  // Feeds every filter the library offers, so none of them can present a value
  // with no rows behind it under whatever else is already selected.
  .get("/facets", async (c) =>
    c.json(
      await listKnowledgeFacets({
        ...(await listFilters(c)),
        status: c.req.query("status"),
      }),
    ),
  )
  .get("/:id/feedback", async (c) =>
    c.json(await listFeedback(c.req.param("id"))),
  )
  .post("/:id/feedback", zValidator("json", feedbackSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(
      await addFeedback({
        ...body,
        knowledgeEntryId: c.req.param("id"),
        userId: await callerUserId(c),
      }),
    );
  })
  .get("/:id/revisions", async (c) =>
    c.json(await listRevisions({ entryId: c.req.param("id") })),
  )
  .get("/:id/revisions/:version", async (c) =>
    c.json(
      await getRevision(
        { entryId: c.req.param("id") },
        Number(c.req.param("version")),
      ),
    ),
  )
  .post("/:id/revert/:version", async (c) => {
    const id = c.req.param("id");
    await assertScopeEditor(c, await entryScope(id));
    return c.json(
      await revertKnowledgeEntry(
        id,
        Number(c.req.param("version")),
        await callerActor(c),
      ),
    );
  })
  .get("/:id/links", async (c) => {
    const id = c.req.param("id");
    const [inbound, outbound] = await Promise.all([
      backlinks({ entryId: id }),
      outboundLinks({ entryId: id }),
    ]);
    return c.json({ inbound, outbound });
  })
  .get("/:id/views", async (c) => {
    const target = { entryId: c.req.param("id") };
    const [stats, history] = await Promise.all([
      viewStats(target),
      viewHistory(target),
    ]);
    return c.json({ ...stats, history });
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const entry = await getKnowledgeEntry(id);
    // Not awaited: a read must not pay for its own bookkeeping. The agent reads
    // through MCP and never reaches here, so this counts people.
    countView({ entryId: id }, await callerUserId(c));
    return c.json(entry);
  })
  .patch("/:id", zValidator("json", knowledgeUpdateSchema), async (c) => {
    const id = c.req.param("id");
    await assertScopeEditor(c, await entryScope(id));
    return c.json(
      await updateKnowledgeEntry(id, c.req.valid("json"), await callerActor(c)),
    );
  })
  .get("/", async (c) => {
    const rows = await listKnowledgeEntries({
      status: c.req.query("status"),
      ...(await listFilters(c)),
    });
    return c.json(rows);
  })
  .post("/", zValidator("json", knowledgeInputSchema), async (c) => {
    const body = c.req.valid("json");
    await assertScopeEditor(c, await newEntryScope(body));
    return c.json(
      await saveKnowledgeEntry({
        ...body,
        createdById: await callerUserId(c),
        actor: await callerActor(c),
      }),
    );
  });

const runSchema = z.object({
  mode: runModeSchema,
  workItemId: z.string().optional(),
  model: z.string().optional(),
  inputTokens: z.number().int().optional(),
  outputTokens: z.number().int().optional(),
  meta: z.record(z.string(), z.any()).optional(),
});

export const analysisRuns = new Hono().post(
  "/",
  zValidator("json", runSchema),
  async (c) => {
    return c.json(await recordRun(c.req.valid("json") as RunInput));
  },
);
