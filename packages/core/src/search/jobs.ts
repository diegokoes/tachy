import { z } from "zod";
import { embedBucketChunks } from "../buckets/search";
import { backfillCodeEmbeddings } from "../code/indexer";
import { defineJob } from "../jobs/registry";
import { backfillEmbeddings } from "../knowledge/knowledge";
import { backfillReferenceEmbeddings } from "../reference/reference";

export function defineSearchJobs() {
  defineJob({
    kind: "embeddings.backfill",
    title: "Embed missing vectors",
    description:
      "Embeds knowledge entries, reference chunks, code chunks and bucket chunks that have no vector. With 'all', re-embeds everything (after a model change).",
    params: z.object({ all: z.boolean().default(false) }),
    queue: "embed",
    timeout: "6h",
    run: async (ctx, p) => {
      const entries = await backfillEmbeddings({ all: p.all });
      await ctx.progress(0.25, `knowledge entries: ${entries}`);
      ctx.signal.throwIfAborted();
      const chunks = await backfillReferenceEmbeddings({ all: p.all });
      await ctx.progress(0.5, `reference chunks: ${chunks}`);
      ctx.signal.throwIfAborted();
      const code = await backfillCodeEmbeddings({ all: p.all });
      await ctx.progress(0.75, `code chunks: ${code}`);
      ctx.signal.throwIfAborted();
      const buckets = await embedBucketChunks({
        all: p.all,
        signal: ctx.signal,
      });
      return { entries, chunks, code, buckets };
    },
  });
}
