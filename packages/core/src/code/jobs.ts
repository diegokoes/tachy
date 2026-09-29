import { z } from "zod";
import { sql } from "../infra/db";
import { defineJob } from "../jobs/registry";
import { indexRepo } from "./indexer";
import { listRepos } from "./repos";
import { repoToken } from "./token";

/** The queued or running reindex of a repo, if there is one. */
export async function reindexInFlight(slug: string): Promise<string | null> {
  const [busy] = await sql`
    select id from job_runs
    where kind = 'repo.reindex' and params->>'repo' = ${slug}
      and status in ('queued', 'running')
    limit 1
  `;
  return busy ? (busy.id as string) : null;
}

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
    resourceClass: "heavy",
    timeout: "2h",
    run: async (ctx, p) => {
      ctx.log(`indexing ${p.repo}${p.line ? ` ${p.line}` : ""}`);
      const res = await indexRepo(p.repo, {
        line: p.line,
        token: await repoToken(p.repo, ctx.requestedBy),
        signal: ctx.signal,
        onProgress: (done, total, ref) =>
          void ctx.progress(
            total ? done / total : 1,
            `${ref}: ${done}/${total} files`,
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
        if (await reindexInFlight(repo.slug)) {
          skipped++;
          continue;
        }
        await ctx.enqueue("repo.reindex", { repo: repo.slug });
        queued++;
      }
      ctx.log(
        `queued ${queued}; ${skipped} already in flight, ${neverIndexed} never indexed`,
      );
      return { queued, skipped, never_indexed: neverIndexed };
    },
  });
}
