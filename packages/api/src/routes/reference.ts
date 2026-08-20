import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  listReferenceDocs,
  getReferenceDoc,
  searchReferenceDocs,
  saveReferenceDoc,
  updateReferenceDoc,
  referenceDocLineage,
  referenceStatusSchema,
  resolveComponentFilter,
  getCustomerIdBySlug,
} from "@tachy/core";
import { assertScopeEditor, callerUserId } from "../authz";
import { csv } from "../query";

const referenceInputSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  productId: z.string().optional(),
  teamId: z.string().optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: referenceStatusSchema.optional(),
  structured: z.record(z.string(), z.any()).optional(),
  docVersion: z.string().optional(),
  supersedes: z.string().optional(),
  component: z.string().nullable().optional(),
  customerSlug: z.string().nullable().optional(),
});

const referenceUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  status: referenceStatusSchema.optional(),
  source: z.string().nullable().optional(),
  structured: z.record(z.string(), z.any()).optional(),
  docVersion: z.string().nullable().optional(),
  component: z.string().nullable().optional(),
  customerSlug: z.string().nullable().optional(),
  expectedVersion: z.number().int().optional(),
});

type QueryCtx = { req: { query(k: string): string | undefined } };

async function listFilters(c: QueryCtx) {
  const tags = csv(c.req.query("tags"));
  const component = c.req.query("component");
  const productId = c.req.query("product_id");
  const customerSlug = c.req.query("customer");
  // Component slugs resolve within a product, so the pair is required — same
  // rule the knowledge route follows.
  const f =
    component && productId
      ? await resolveComponentFilter(productId, component)
      : undefined;
  const merged = [...(tags ?? []), ...(f?.extraTags ?? [])];
  return {
    productId,
    teamId: c.req.query("team_id"),
    tags: merged.length ? merged : undefined,
    componentId: f?.componentId,
    componentTags: f?.componentTags,
    customerId: customerSlug
      ? await getCustomerIdBySlug(customerSlug)
      : undefined,
    docVersion: c.req.query("doc_version"),
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
  };
}

export const reference = new Hono()
  .get("/search", async (c) => {
    const rows = await searchReferenceDocs(
      c.req.query("q") ?? "",
      await listFilters(c),
    );
    return c.json(rows);
  })
  .get("/:id/lineage", async (c) =>
    c.json(await referenceDocLineage(c.req.param("id"))),
  )
  .get("/:id", async (c) => c.json(await getReferenceDoc(c.req.param("id"))))
  .patch("/:id", zValidator("json", referenceUpdateSchema), async (c) => {
    const id = c.req.param("id");
    const doc = await getReferenceDoc(id);
    await assertScopeEditor(c, {
      productId: doc.product_id,
      teamId: doc.team_id,
    });
    return c.json(await updateReferenceDoc(id, c.req.valid("json")));
  })
  .get("/", async (c) => {
    const rows = await listReferenceDocs({
      status: c.req.query("status"),
      ...(await listFilters(c)),
    });
    return c.json(rows);
  })
  .post("/", zValidator("json", referenceInputSchema), async (c) => {
    const body = c.req.valid("json");
    await assertScopeEditor(c, {
      productId: body.productId,
      teamId: body.teamId,
    });
    return c.json(
      await saveReferenceDoc({ ...body, createdById: await callerUserId(c) }),
    );
  });
