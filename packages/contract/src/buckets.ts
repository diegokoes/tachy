/**
 * Buckets: document collections pushed in from outside tachy. The pusher and
 * the admin panel both need these, so they live here rather than in core.
 */
export const INGEST_TOKEN_PREFIX = "tachy_ing_";
/** The batch envelope version the ingest route accepts. */
export const BUCKET_BATCH_VERSION = 1;
export const MAX_BUCKET_BATCH_DOCS = 200;
/** One document's text. Larger pages are rejected rather than truncated. */
export const MAX_BUCKET_DOC_CHARS = 1_000_000;
export const BUCKET_BATCH_MAX_BYTES = 16 * 1024 * 1024;

/** Where a bucket's pusher sends its batches, relative to the tachy origin. */
export const bucketIngestPath = (slug: string): string =>
  `/ingest/buckets/${slug}/batches`;

export interface BucketRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  source: string | null;
  ingest_token_hint: string;
  token_rotated_at: string;
  last_batch_at: string | null;
  last_sync_id: string | null;
  teams: { slug: string; name: string }[];
  docs: number;
  pending_chunks: number;
  created_at: string;
}

/** A bucket as created or rotated: the only time the token is visible. */
export interface BucketWithToken {
  bucket: BucketRow;
  token: string;
}
