import { z } from "zod";
import { userSoleTeamId } from "../access/users";
import { resolveCredential, sourceCredentialName } from "../config/credentials";
import { sql } from "../infra/db";
import { defineJob } from "../jobs/registry";
import { indexRepo } from "./indexer";
import { getRepoBySlug } from "./repos";

/**
 * The token of the connection a repo was linked through: the given user's own
 * (or their team's) when they have one, otherwise the org-wide one.
 */
export async function repoToken(
  slug: string,
  userId: string | null = null,
): Promise<string | undefined> {
  const repo = await getRepoBySlug(slug);
  if (!repo.source_slug) return undefined;
  const [conn] = await sql`
    select source_type from source_connections where slug = ${repo.source_slug}
  `;
  if (!conn) return undefined;
  const scope = userId
    ? { userId, teamId: (await userSoleTeamId(userId)) ?? undefined }
    : {};
  return resolveCredential(
    sourceCredentialName(conn.source_type, repo.source_slug),
    scope,
  );
}

export function defineCodeJobs() {
  defineJob({
    kind: "repo.reindex",
    title: "Reindex a linked repository",
    description:
      "Fetches the repository and re-embeds the files that changed since the last index.",
    params: z.object({ repo: z.string().min(1) }),
    resourceClass: "heavy",
    timeout: "2h",
    run: async (ctx, p) => {
      ctx.log(`indexing ${p.repo}`);
      const res = await indexRepo(p.repo, {
        token: await repoToken(p.repo, ctx.requestedBy),
      });
      return { ...res };
    },
  });
}
