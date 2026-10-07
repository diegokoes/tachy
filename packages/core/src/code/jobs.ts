import { z } from "zod";
import type { RepoIndexRun } from "@tachy/contract";
import { sql } from "../infra/db";
import { count, num } from "../jobs/present";
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
    title: "Index repository",
    description:
      "Fetches the repository's tracked lines and embeds the files that changed since the last index.",
    params: z.object({
      repo: z.string().min(1),
      line: z.string().min(1).optional(),
      full: z
        .boolean()
        .optional()
        .describe(
          "Cut and embed every file again, not only what changed. For after a change of chunk size or embedding model.",
        ),
    }),
    queue: "index",
    dedupeKey: (p) => p.repo,
    subject: (p) =>
      `${p.repo}${p.line ? ` @ ${p.line}` : ""}${p.full ? " (full)" : ""}`,
    outcome: (output) => {
      const lines = (output.lines ?? []) as {
        ref: string;
        upToDate: boolean;
        filesIndexed: number;
        filesEmbedded: number;
        filesDeleted: number;
        versionLabel?: string | null;
      }[];
      const said = lines.map((l) =>
        l.upToDate
          ? `up to date${l.versionLabel ? ` at ${l.versionLabel}` : ""}`
          : [
              `${count(l.filesIndexed, "file")} indexed`,
              l.filesEmbedded ? `${num(l.filesEmbedded)} embedded` : "",
              l.filesDeleted ? `${num(l.filesDeleted)} removed` : "",
            ]
              .filter(Boolean)
              .join(", "),
      );
      if (!said.length) return null;
      return said.length === 1
        ? said[0]
        : lines.map((l, i) => `${l.ref}: ${said[i]}`).join(" · ");
    },
    timeout: "8h",
    run: async (ctx, params) => {
      ctx.log(`indexing ${params.repo}${params.line ? ` ${params.line}` : ""}`);
      const indexed = await indexRepo(params.repo, {
        line: params.line,
        full: params.full,
        token: await repoToken(params.repo, ctx.requestedBy),
        signal: ctx.signal,
        onProgress: (done, total, ref, at) =>
          void ctx.progress(
            (at.index + (total ? done / total : 0)) / at.count,
            `${ref}${at.count > 1 ? ` (${at.index + 1}/${at.count})` : ""}: ${total ? `${done}/${total} files` : "fetching"}`,
          ),
      });
      return { ...indexed };
    },
  });

  defineJob({
    kind: "repos.refresh",
    title: "Index all repositories",
    description:
      "Queues a reindex of each linked repository not being indexed already, as runs of their own under this one. With scope 'indexed' (the nightly default) it skips repositories never indexed, which wait for someone to index them; 'all' takes those too. A repo with no new commits costs a fetch and a tree diff.",
    params: z.object({
      scope: z.enum(["indexed", "all"]).default("indexed"),
      full: z
        .boolean()
        .optional()
        .describe(
          "Cut and embed every file of every repository again. For after a change of chunk size or embedding model; takes as long as the first index did.",
        ),
    }),
    defaultSchedule: "40 2 * * *",
    dedupeKey: () => "all",
    subject: (p) => (p.scope === "all" ? "including never indexed" : null),
    outcome: (o) =>
      [
        `${count(Number(o.queued ?? 0), "repository", "repositories")} queued`,
        o.skipped ? `${o.skipped} already running` : "",
        o.never_indexed ? `${o.never_indexed} never indexed` : "",
      ]
        .filter(Boolean)
        .join(", "),
    timeout: "10m",
    run: async (ctx, params) => {
      let queued = 0;
      let skipped = 0;
      let neverIndexed = 0;
      const repos = await listRepos();
      for (const [index, repo] of repos.entries()) {
        ctx.signal.throwIfAborted();
        await ctx.progress(index / repos.length, repo.slug);
        if (
          params.scope !== "all" &&
          !repo.lines.some((l) => l.indexed_commit || l.indexing_commit)
        ) {
          neverIndexed++;
          continue;
        }
        if (
          await ctx.enqueue("repo.reindex", {
            repo: repo.slug,
            ...(params.full ? { full: true } : {}),
          })
        )
          queued++;
        else skipped++;
      }
      ctx.log(
        `queued ${queued}; ${skipped} already in flight, ${neverIndexed} never indexed`,
      );
      return { queued, skipped, never_indexed: neverIndexed };
    },
  });
}
