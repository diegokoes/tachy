import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { SLUG_RE } from "@tachy/core";
import {
  createBucket,
  deleteBucket,
  getBucket,
  listBucketDocs,
  listBuckets,
  rotateBucketToken,
  searchBucket,
  updateBucket,
} from "@tachy/core/buckets";
import { requireAdmin } from "../../auth";
import { callerUserId } from "../../authz";

const createSchema = z.object({
  slug: z
    .string()
    .regex(
      SLUG_RE,
      "bucket slug must be lowercase letters, digits and hyphens",
    ),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  teams: z.array(z.string()).default([]),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullish(),
  teams: z.array(z.string()).optional(),
});

/** Buckets: app admins create them, assign teams, and hand out ingest tokens. */
export const buckets = new Hono()
  .use("/buckets", requireAdmin)
  .use("/buckets/*", requireAdmin)
  .get("/buckets", async (c) => c.json(await listBuckets()))
  .post("/buckets", zValidator("json", createSchema), async (c) =>
    c.json(await createBucket(c.req.valid("json"), await callerUserId(c)), 201),
  )
  .patch("/buckets/:slug", zValidator("json", updateSchema), async (c) =>
    c.json(await updateBucket(c.req.param("slug"), c.req.valid("json"))),
  )
  .post("/buckets/:slug/token", async (c) =>
    c.json(await rotateBucketToken(c.req.param("slug"))),
  )
  .delete("/buckets/:slug", async (c) => {
    await deleteBucket(c.req.param("slug"));
    return c.json({ ok: true });
  })
  .get("/buckets/:slug/docs", async (c) => {
    const bucket = await getBucket(c.req.param("slug"));
    const q = c.req.query("q")?.trim();
    return c.json(
      q
        ? await searchBucket(q, { bucketIds: [bucket.id], limit: 20 })
        : await listBucketDocs(bucket.id),
    );
  });
