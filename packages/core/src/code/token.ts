import { userSoleTeamId } from "../access/users";
import { resolveCredential, sourceCredentialName } from "../config/credentials";
import { sql } from "../infra/db";
import { badInput } from "../infra/errors";
import { getRepoBySlug } from "./repos";

const AZURE_HOST_RE = /^(?:dev\.azure\.com|[a-z0-9-]+\.visualstudio\.com)$/i;

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * Whether a connection's token may be sent to a repo URL. The URL is typed by
 * whoever links the repo, so without this check a repo pointed at another host
 * would receive the connection's PAT in its Authorization header.
 */
export function tokenMaySendTo(
  conn: { source_type: string; base_url: string | null },
  repoUrl: string,
): boolean {
  const repoHost = hostOf(repoUrl);
  if (!repoHost) return false;
  const base =
    conn.base_url ||
    (conn.source_type === "github" ? "https://api.github.com" : "");
  const baseHost = hostOf(base);
  if (!baseHost) return false;
  if (repoHost === baseHost || baseHost === `api.${repoHost}`) return true;
  return AZURE_HOST_RE.test(baseHost) && AZURE_HOST_RE.test(repoHost);
}

/**
 * The token of a source connection for git calls against `repoUrl`: the given
 * user's own (or their team's) when they have one, otherwise the org-wide one.
 * Only an http(s) remote takes a header; ssh authenticates by key.
 */
export async function connectionToken(
  sourceSlug: string | null,
  repoUrl: string,
  userId: string | null = null,
): Promise<string | undefined> {
  if (!sourceSlug || !/^https?:\/\//i.test(repoUrl)) return undefined;
  const [conn] = await sql`
    select source_type, base_url from source_connections where slug = ${sourceSlug}
  `;
  if (!conn) return undefined;
  if (!tokenMaySendTo(conn as never, repoUrl))
    throw badInput(
      `'${repoUrl}' is not on the host of connection '${sourceSlug}' (${conn.base_url ?? "no base_url"}), so its token is not sent there`,
    );
  const scope = userId
    ? { userId, teamId: (await userSoleTeamId(userId)) ?? undefined }
    : {};
  return resolveCredential(
    sourceCredentialName(conn.source_type, sourceSlug),
    scope,
  );
}

/** The token a linked repo's git calls carry. */
export async function repoToken(
  slug: string,
  userId: string | null = null,
): Promise<string | undefined> {
  const repo = await getRepoBySlug(slug);
  return connectionToken(repo.source_slug, repo.url, userId);
}
