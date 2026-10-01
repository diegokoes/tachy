import { z } from "zod";
import { defineJob } from "../jobs/registry";
import { embedBucketChunks } from "./search";

export function defineBucketJobs() {
  defineJob({
    kind: "bucket.embed",
    title: "Embed a bucket's new documents",
    description:
      "Embeds the chunks that pushed batches left without vectors. Queued by the ingest route; text search works before it runs.",
    params: z.object({ bucket_id: z.uuid() }),
    queue: "embed",
    dedupeKey: (p) => p.bucket_id,
    timeout: "2h",
    run: async (ctx, p) => {
      const chunks = await embedBucketChunks({
        bucketId: p.bucket_id,
        signal: ctx.signal,
      });
      return { chunks };
    },
  });
}
