import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  INGEST_TOKEN_PREFIX,
  SLUG_RE,
  type BucketRow,
  type BucketWithToken,
} from "@tachy/contract";
import { sql, type Db } from "../infra/db";
import { badInput, conflict, notFound } from "../infra/errors";

export interface BucketInput {
  slug: string;
  name: string;
  description?: string | null;
  teams?: string[];
}

export interface BucketUpdate {
  name?: string;
  description?: string | null;
  teams?: string[];
}

/**
 * The token is 256 random bits, so a plain sha256 is enough to make the stored
 * column useless to whoever reads it; a slow hash buys nothing here.
 */
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest();

function newToken() {
  const token = INGEST_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token), hint: token.slice(-4) };
}

const BUCKET_COLUMNS = sql`
  b.id, b.slug, b.name, b.description, b.source, b.ingest_token_hint,
  b.token_rotated_at, b.last_batch_at, b.last_sync_id, b.created_at,
  coalesce((
    select json_agg(json_build_object('slug', t.slug, 'name', t.name) order by t.slug)
    from bucket_teams bt join teams t on t.id = bt.team_id
    where bt.bucket_id = b.id
  ), '[]'::json) as teams,
  (select count(*)::int from bucket_docs d where d.bucket_id = b.id) as docs,
  (select count(*)::int from bucket_doc_chunks c
     join bucket_docs d on d.id = c.doc_id
     where d.bucket_id = b.id and c.embedding is null) as pending_chunks
`;

export async function listBuckets(ids?: string[]): Promise<BucketRow[]> {
  const rows = await sql`
    select ${BUCKET_COLUMNS} from buckets b
    ${ids ? sql`where b.id = any(${ids}::uuid[])` : sql``}
    order by b.name
  `;
  return rows as unknown as BucketRow[];
}

export async function getBucket(slug: string): Promise<BucketRow> {
  const [row] =
    await sql`select ${BUCKET_COLUMNS} from buckets b where b.slug = ${slug}`;
  if (!row) throw notFound(`bucket '${slug}' not found`);
  return row as unknown as BucketRow;
}

async function setTeams(db: Db, bucketId: string, teams: string[]) {
  const slugs = [...new Set(teams)];
  const found = await db`select id, slug from teams where slug = any(${slugs})`;
  const missing = slugs.filter((s) => !found.some((t) => t.slug === s));
  if (missing.length) throw badInput(`unknown team: ${missing.join(", ")}`);
  await db`delete from bucket_teams where bucket_id = ${bucketId}`;
  if (found.length)
    await db`
      insert into bucket_teams (bucket_id, team_id)
      select ${bucketId}, unnest(${found.map((t) => t.id as string)}::uuid[])
    `;
}

export async function createBucket(
  input: BucketInput,
  userId: string | null,
): Promise<BucketWithToken> {
  if (!SLUG_RE.test(input.slug))
    throw badInput(
      `Invalid bucket slug '${input.slug}': lowercase letters, digits and hyphens only.`,
    );
  const t = newToken();
  await sql.begin(async (tx) => {
    const [row] = await tx`
      insert into buckets (slug, name, description, ingest_token_hash, ingest_token_hint, created_by)
      values (${input.slug}, ${input.name}, ${input.description ?? null}, ${t.hash}, ${t.hint}, ${userId})
      on conflict (slug) do nothing
      returning id
    `;
    if (!row) throw conflict(`bucket '${input.slug}' already exists`);
    await setTeams(tx, row.id, input.teams ?? []);
  });
  return { bucket: await getBucket(input.slug), token: t.token };
}

export async function updateBucket(
  slug: string,
  patch: BucketUpdate,
): Promise<BucketRow> {
  await sql.begin(async (tx) => {
    const [row] = await tx`
      update buckets set
        name = coalesce(${patch.name ?? null}, name),
        description = ${patch.description === undefined ? sql`description` : patch.description}
      where slug = ${slug}
      returning id
    `;
    if (!row) throw notFound(`bucket '${slug}' not found`);
    if (patch.teams) await setTeams(tx, row.id, patch.teams);
  });
  return getBucket(slug);
}

/** A new token; the old one stops working at once. */
export async function rotateBucketToken(
  slug: string,
): Promise<BucketWithToken> {
  const t = newToken();
  const [row] = await sql`
    update buckets set ingest_token_hash = ${t.hash}, ingest_token_hint = ${t.hint},
                       token_rotated_at = now()
    where slug = ${slug}
    returning id
  `;
  if (!row) throw notFound(`bucket '${slug}' not found`);
  return { bucket: await getBucket(slug), token: t.token };
}

export async function deleteBucket(slug: string): Promise<void> {
  const rows = await sql`delete from buckets where slug = ${slug} returning id`;
  if (!rows.length) throw notFound(`bucket '${slug}' not found`);
}

export interface IngestBucket {
  id: string;
  slug: string;
}

/**
 * The bucket a pusher's token opens, or null. The slug in the URL has to match
 * too, so a token sent to the wrong bucket fails instead of writing elsewhere.
 */
export async function bucketByToken(
  slug: string,
  token: string,
): Promise<IngestBucket | null> {
  if (!token.startsWith(INGEST_TOKEN_PREFIX)) return null;
  const [row] = await sql`
    select id, slug, ingest_token_hash from buckets where slug = ${slug}
  `;
  if (!row) return null;
  const stored = row.ingest_token_hash as Buffer;
  const given = hashToken(token);
  if (stored.length !== given.length || !timingSafeEqual(stored, given))
    return null;
  return { id: row.id, slug: row.slug };
}
