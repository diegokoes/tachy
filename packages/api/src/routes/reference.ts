import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  listReferenceDocs, getReferenceDoc, searchReferenceDocs,
  saveReferenceDoc, updateReferenceDoc, referenceStatusSchema,
} from "@tachy/core";
import { assertScopeEditor, callerUserId } from "../authz";

const referenceInputSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  productId: z.string().optional(),
  teamId: z.string().optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: referenceStatusSchema.optional(),
  structured: z.record(z.string(), z.any()).optional(),
});

const referenceUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  status: referenceStatusSchema.optional(),
  source: z.string().nullable().optional(),
  structured: z.record(z.string(), z.any()).optional(),
  expectedVersion: z.number().int().optional(),
});

const csv = (v: string | undefined) => v?.split(",").map((t) => t.trim()).filter(Boolean);




export const reference = new Hono()
  .get("/search", async (c) => {
    const tags = csv(c.req.query("tags"));
    const rows = await searchReferenceDocs(c.req.query("q") ?? "", {
      productId: c.req.query("product_id"),
      teamId: c.req.query("team_id"),
      tags: tags?.length ? tags : undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    });
    return c.json(rows);
  })
  .get("/:id", async (c) => c.json(await getReferenceDoc(c.req.param("id"))))
  .patch("/:id", zValidator("json", referenceUpdateSchema), async (c) => {
    const id = c.req.param("id");
    const doc = await getReferenceDoc(id); 
    await assertScopeEditor(c, { productId: doc.product_id, teamId: doc.team_id });
    return c.json(await updateReferenceDoc(id, c.req.valid("json")));
  })
  .get("/", async (c) => {
    const tags = csv(c.req.query("tags"));
    const rows = await listReferenceDocs({
      status: c.req.query("status"),
      productId: c.req.query("product_id"),
      teamId: c.req.query("team_id"),
      tags: tags?.length ? tags : undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    });
    return c.json(rows);
  })
  .post("/", zValidator("json", referenceInputSchema), async (c) => {
    const body = c.req.valid("json");
    await assertScopeEditor(c, { productId: body.productId, teamId: body.teamId });
    return c.json(await saveReferenceDoc({ ...body, createdById: await callerUserId(c) }));
  });
