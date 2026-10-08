import { z } from "zod";
import { embedBucketChunks } from "../buckets/search";
import { backfillCodeEmbeddings } from "../code/indexer";
import { count } from "../jobs/present";
import { defineJob } from "../jobs/registry";
import { backfillEmbeddings } from "../knowledge/knowledge";
import { backfillReferenceEmbeddings } from "../reference/reference";

export function defineSearchJobs() {
  defineJob({
    kind: "embeddings.backfill",
    title: "Rebuild missing embeddings",
    description:
      "Embeds knowledge entries, reference chunks, code chunks and bucket chunks that have no vector, or one made by another embedding model. Run it after a model change; it picks up where an interrupted run stopped. With 'all', re-embeds everything.",
    params: z.object({ all: z.boolean().default(false) }),
    queue: "embed",
    subject: (p) => (p.all ? "everything" : null),
    outcome: (output) => {
      const embedded = Object.values(output).reduce<number>(
        (sum, v) => sum + (typeof v === "number" ? v : 0),
        0,
      );
      return embedded
        ? `${count(embedded, "vector")} embedded`
        : "nothing missing";
    },
    timeout: "6h",
    run: async (ctx, params) => {
      const entries = await backfillEmbeddings({ all: params.all });
      await ctx.progress(0.25, `knowledge entries: ${entries}`);
      ctx.signal.throwIfAborted();
      const chunks = await backfillReferenceEmbeddings({ all: params.all });
      await ctx.progress(0.5, `reference chunks: ${chunks}`);
      ctx.signal.throwIfAborted();
      const code = await backfillCodeEmbeddings({ all: params.all });
      await ctx.progress(0.75, `code chunks: ${code}`);
      ctx.signal.throwIfAborted();
      const buckets = await embedBucketChunks({
        all: params.all,
        signal: ctx.signal,
      });
      return { entries, chunks, code, buckets };
    },
  });
}
