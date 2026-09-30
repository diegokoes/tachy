import { z } from "zod";
import { defineJob } from "../jobs/registry";
import { indexRepo } from "./indexer";
import { listRepos } from "./repos";
import { repoToken } from "./token";

export function defineCodeJobs() {
  defineJob({
    kind: "repo.reindex",
    title: "Reindex a linked repository",
    description:
      "Fetches the repository's tracked lines and embeds the files that changed since the last index.",
    params: z.object({
      repo: z.string().min(1),
      line: z.string().min(1).optional(),
    }),
    queue: "index",
    dedupeKey: (p) => p.repo,
    timeout: "2h",
    run: async (ctx, p) => {
      ctx.log(`indexing ${p.repo}${p.line ? ` ${p.line}` : ""}`);
      const res = await indexRepo(p.repo, {
        line: p.line,
        token: await repoToken(p.repo, ctx.requestedBy),
        signal: ctx.signal,
        onProgress: (done, total, ref, at) =>
          void ctx.progress(
            (at.index + (total ? done / total : 0)) / at.count,
            `${ref}${at.count > 1 ? ` (${at.index + 1}/${at.count})` : ""}: ${total ? `${done}/${total} files` : "fetching"}`,
          ),
      });
      return { ...res };
    },
  });

  defineJob({
    kind: "repos.refresh",
    title: "Refresh linked repositories",
    description:
      "Queues a reindex of every repository that has been indexed before and is not being indexed now. A repo with no new commits costs a fetch and a tree diff. Repositories never indexed wait for someone to index them.",
    params: z.object({}),
    defaultSchedule: "40 2 * * *",
    timeout: "10m",
    run: async (ctx) => {
      let queued = 0;
      let skipped = 0;
      let neverIndexed = 0;
      for (const repo of await listRepos()) {
        if (!repo.lines.some((l) => l.indexed_commit || l.indexing_commit)) {
          neverIndexed++;
          continue;
        }
        if (await ctx.enqueue("repo.reindex", { repo: repo.slug })) queued++;
        else skipped++;
      }
      ctx.log(
        `queued ${queued}; ${skipped} already in flight, ${neverIndexed} never indexed`,
      );
      return { queued, skipped, never_indexed: neverIndexed };
    },
  });
}
