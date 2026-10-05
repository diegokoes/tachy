import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getConnInfo } from "@hono/node-server/conninfo";
import { BUCKET_BATCH_MAX_BYTES } from "@tachy/core";
import {
  bucketBatchSchema,
  bucketByToken,
  ingestBatch,
} from "@tachy/core/buckets";
import { log } from "@tachy/core/infra";
import { failureThrottle } from "../throttle";

const badTokens = failureThrottle(10);

/**
 * Who is pushing. Behind Caddy that is X-Forwarded-For, which Caddy sets from
 * the connection it accepted and never takes from the request; without a proxy
 * it is the socket.
 */
function callerAddress(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Where pushers deliver: scripts that can reach a source tachy cannot, holding
 * one bucket's ingest token. Mounted outside `/api` because that token opens
 * this route and nothing else; a session or the admin token does not open it.
 */
export const ingest = new Hono().post(
  "/buckets/:slug/batches",
  async (c, next) => {
    const token = (c.req.header("authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    );
    const caller = `${c.req.param("slug")} ${callerAddress(c)}`;
    if (badTokens.blocked(caller))
      return c.json({ error: "too many failed tokens; wait a minute" }, 429, {
        "Retry-After": "60",
      });
    const bucket = token
      ? await bucketByToken(c.req.param("slug"), token)
      : null;
    if (!bucket) {
      badTokens.fail(caller);
      return c.json({ error: "invalid or missing ingest token" }, 401);
    }
    c.set("bucket" as never, bucket as never);
    await next();
  },
  bodyLimit({
    maxSize: BUCKET_BATCH_MAX_BYTES,
    onError: (c) =>
      c.json(
        {
          error: `batch larger than ${BUCKET_BATCH_MAX_BYTES} bytes; send fewer documents per batch`,
        },
        413,
      ),
  }),
  async (c) => {
    const bucket = c.get("bucket" as never) as { id: string; slug: string };
    const batch = bucketBatchSchema.parse(await c.req.json());
    const result = await ingestBatch(bucket, batch);
    log("info", "bucket_batch", {
      bucket: bucket.slug,
      source: batch.source,
      sync_id: batch.sync_id,
      index: batch.batch.index,
      ...result,
    });
    return c.json(result);
  },
);
