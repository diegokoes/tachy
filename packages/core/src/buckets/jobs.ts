import { z } from "zod";
import { count } from "../jobs/present";
import { defineJob } from "../jobs/registry";
import { embedBucketChunks } from "./search";

export function defineBucketJobs() {
  defineJob({
    kind: "bucket.embed",
    title: "Embed bucket documents",
    description:
      "Embeds the chunks that pushed batches left without vectors. Queued by the ingest route; text search works before it runs.",
    params: z.object({ bucket_id: z.uuid() }),
    queue: "embed",
    dedupeKey: (p) => p.bucket_id,
    outcome: (o) => `${count(Number(o.chunks ?? 0), "chunk")} embedded`,
    timeout: "2h",
    run: async (ctx, params) => {
      const chunks = await embedBucketChunks({
        bucketId: params.bucket_id,
        signal: ctx.signal,
      });
      return { chunks };
    },
  });
}
