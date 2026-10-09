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
  readableBucket,
  rotateBucketToken,
  searchBucket,
  updateBucket,
} from "@tachy/core/buckets";
import { requireAdmin } from "../../auth";
import { callerUserId, isAdminIdentity, requireCaller } from "../../authz";

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

/**
 * Buckets: app admins create them, assign teams, and hand out ingest tokens.
 * Anyone signed in sees the list; the documents of a bucket go to the teams it
 * is assigned to.
 */
export const buckets = new Hono()
  .get("/buckets", async (c) => c.json(await listBuckets()))
  .post("/buckets", requireAdmin, zValidator("json", createSchema), async (c) =>
    c.json(await createBucket(c.req.valid("json"), await callerUserId(c)), 201),
  )
  .patch(
    "/buckets/:slug",
    requireAdmin,
    zValidator("json", updateSchema),
    async (c) =>
      c.json(await updateBucket(c.req.param("slug"), c.req.valid("json"))),
  )
  .post("/buckets/:slug/token", requireAdmin, async (c) =>
    c.json(await rotateBucketToken(c.req.param("slug")!)),
  )
  .delete("/buckets/:slug", requireAdmin, async (c) => {
    await deleteBucket(c.req.param("slug")!);
    return c.json({ ok: true });
  })
  .get("/buckets/:slug/docs", async (c) => {
    const slug = c.req.param("slug");
    if (!isAdminIdentity(c)) await readableBucket(await requireCaller(c), slug);
    const bucket = await getBucket(slug);
    const query = c.req.query("q")?.trim();
    return c.json(
      query
        ? await searchBucket(query, { bucketIds: [bucket.id], limit: 20 })
        : await listBucketDocs(bucket.id),
    );
  });
