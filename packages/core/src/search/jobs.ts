import { z } from "zod";
import { backfillCodeEmbeddings } from "../code/indexer";
import { defineJob } from "../jobs/registry";
import { backfillEmbeddings } from "../knowledge/knowledge";
import { backfillReferenceEmbeddings } from "../reference/reference";

export function defineSearchJobs() {
  defineJob({
    kind: "embeddings.backfill",
    title: "Embed missing vectors",
    description:
      "Embeds knowledge entries, reference chunks and code chunks that have no vector. With 'all', re-embeds everything (after a model change).",
    params: z.object({ all: z.boolean().default(false) }),
    resourceClass: "heavy",
    timeout: "6h",
    run: async (ctx, p) => {
      const entries = await backfillEmbeddings({ all: p.all });
      await ctx.progress(0.33, `knowledge entries: ${entries}`);
      ctx.signal.throwIfAborted();
      const chunks = await backfillReferenceEmbeddings({ all: p.all });
      await ctx.progress(0.66, `reference chunks: ${chunks}`);
      ctx.signal.throwIfAborted();
      const code = await backfillCodeEmbeddings({ all: p.all });
      return { entries, chunks, code };
    },
  });
}
