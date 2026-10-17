import { projectToken, type Mention, type Mentionables } from "@tachy/contract";
import { readableBucket, readableBuckets } from "../buckets/access";
import { getRepoBySlug, listRepos, reposInProject } from "../code/repos";

/** Every repo, since repos carry no team; buckets only where shared with the user. */
export async function listMentionables(
  userId: string | null,
): Promise<Mentionables> {
  const [repos, buckets] = await Promise.all([
    listRepos(),
    readableBuckets(userId),
  ]);
  const projects = new Set(
    repos.flatMap((r) => (r.project_key ? [projectToken(r.project_key)] : [])),
  );
  return {
    repos: repos.map((r) => ({
      slug: r.slug,
      product_slug: r.product_slug,
      project: r.project_key ? projectToken(r.project_key) : null,
    })),
    buckets: buckets.map((b) => ({ slug: b.slug, name: b.name })),
    projects: [...projects].sort(),
  };
}

/** Throws not-found or forbidden for the first mention the user cannot attach. */
export async function checkMentions(
  userId: string | null,
  mentions: Mention[],
): Promise<void> {
  for (const mention of mentions) {
    if (mention.kind === "repo") await getRepoBySlug(mention.key);
    else if (mention.kind === "bucket")
      await readableBucket(userId, mention.key);
    else await reposInProject(mention.key);
  }
}
