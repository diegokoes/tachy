import { z } from "zod";
import type { RepoIndexRun } from "@tachy/contract";
import { sql } from "../infra/db";
import { defineJob } from "../jobs/registry";
import { indexRepo } from "./indexer";
import { listRepos } from "./repos";
import { repoToken } from "./token";

/** Each repo's queued or running reindex, by slug. */
export async function activeReindexes(): Promise<Map<string, RepoIndexRun>> {
  const rows = await sql`
    select params->>'repo' as repo, id, status, params->>'line' as line,
           progress, progress_note, created_at
    from job_runs
    where kind = 'repo.reindex' and status in ('queued', 'running')
    order by created_at
  `;
  return new Map(
    rows.map((r) => [
      r.repo as string,
      {
        id: r.id,
        status: r.status,
        line: r.line ?? null,
        progress: r.progress,
        progress_note: r.progress_note,
        queued_at: new Date(r.created_at).toISOString(),
      },
    ]),
  );
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
    title: "Reindex linked repositories",
    description:
      "Queues a reindex of each linked repository not being indexed already, as runs of their own under this one. With scope 'indexed' (the nightly default) it skips repositories never indexed, which wait for someone to index them; 'all' takes those too. A repo with no new commits costs a fetch and a tree diff.",
    params: z.object({
      scope: z.enum(["indexed", "all"]).default("indexed"),
    }),
    defaultSchedule: "40 2 * * *",
    dedupeKey: () => "all",
    timeout: "10m",
    run: async (ctx, p) => {
      let queued = 0;
      let skipped = 0;
      let neverIndexed = 0;
      const repos = await listRepos();
      for (const [i, repo] of repos.entries()) {
        ctx.signal.throwIfAborted();
        await ctx.progress(i / repos.length, repo.slug);
        if (
          p.scope !== "all" &&
          !repo.lines.some((l) => l.indexed_commit || l.indexing_commit)
        ) {
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
