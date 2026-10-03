import { sql } from "../infra/db";
import { forbidden, notFound } from "../infra/errors";
import { isGlobalAdmin } from "../access/permissions";

export interface ReadableBucket {
  id: string;
  slug: string;
}

/**
 * The buckets a user may read: those assigned to one of their teams. App
 * admins read all of them, and so does a null user, which is how open mode and
 * a deployment with no admins yet reach here.
 */
export async function readableBuckets(
  userId: string | null | undefined,
): Promise<ReadableBucket[]> {
  if (!userId || (await isGlobalAdmin(userId)))
    return (await sql`select id, slug from buckets order by slug`) as unknown as ReadableBucket[];
  return (await sql`
    select distinct b.id, b.slug
    from buckets b
    join bucket_teams bt on bt.bucket_id = b.id
    join team_members tm on tm.team_id = bt.team_id
    where tm.user_id = ${userId}
    order by b.slug
  `) as unknown as ReadableBucket[];
}

/** The bucket by slug, if the user may read it. */
export async function readableBucket(
  userId: string | null | undefined,
  slug: string,
): Promise<ReadableBucket> {
  const all = await readableBuckets(userId);
  const hit = all.find((b) => b.slug === slug);
  if (hit) return hit;
  const [exists] = await sql`select 1 from buckets where slug = ${slug}`;
  if (!exists) throw notFound(`bucket '${slug}' not found`);
  throw forbidden(`bucket '${slug}' is not shared with any of your teams`);
}
