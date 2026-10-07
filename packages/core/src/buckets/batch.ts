import { createHash } from "node:crypto";
import { z } from "zod";
import {
  BUCKET_BATCH_VERSION,
  MAX_BUCKET_BATCH_DOCS,
  MAX_BUCKET_DOC_CHARS,
} from "@tachy/contract";
import { sql, jsonb, type Db } from "../infra/db";
import { enqueueRun } from "../jobs/runs";
import { chunkText } from "../search/chunk";
import type { IngestBucket } from "./buckets";

const key = z.string().min(1).max(500);

/**
 * What a pusher sends. Generic: anything source-specific travels in `metadata`,
 * so a second source needs a script, not a schema change. Unknown fields are
 * dropped.
 */
export const bucketBatchSchema = z.object({
  version: z.literal(BUCKET_BATCH_VERSION, {
    error: `unsupported batch version; this server accepts version ${BUCKET_BATCH_VERSION}`,
  }),
  source: z.string().min(1).max(100),
  sync_id: z.string().min(1).max(100),
  mode: z.enum(["full", "incremental"]),
  batch: z.object({
    index: z.number().int().nonnegative(),
    is_last: z.boolean(),
    prune: z.boolean().optional(),
  }),
  upserts: z
    .array(
      z.object({
        key,
        title: z.string().min(1).max(1000),
        url: z.url().nullish(),
        path: z.array(z.string().max(500)).max(50).default([]),
        version: z.union([z.string(), z.number()]).nullish(),
        modified_at: z.iso.datetime({ offset: true }).nullish(),
        text: z.string().max(MAX_BUCKET_DOC_CHARS).default(""),
        metadata: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(MAX_BUCKET_BATCH_DOCS)
    .default([]),
  deletes: z
    .array(z.object({ key }))
    .max(MAX_BUCKET_BATCH_DOCS * 10)
    .default([]),
});
export type BucketBatch = z.infer<typeof bucketBatchSchema>;
type BucketUpsert = BucketBatch["upserts"][number];

export interface BucketBatchResult {
  upserted: number;
  unchanged: number;
  deleted: number;
  pruned: number;
  pending_chunks: number;
}

const breadcrumb = (path: string[]) => path.join(" > ");

/** Covers everything the chunks are built from, so equal means reusable. */
const bodySha = (d: BucketUpsert) =>
  createHash("sha256")
    .update(`${d.title}\0${breadcrumb(d.path)}\0${d.text}`)
    .digest("hex");

/**
 * Each chunk carries the page's title and place in the tree, so a passage that
 * never names its subject still matches a query about it.
 */
export function bucketChunks(
  doc: Pick<BucketUpsert, "title" | "path" | "text">,
) {
  const head = [doc.title, breadcrumb(doc.path)].filter(Boolean).join("\n");
  const parts = chunkText(doc.text);
  return parts.length ? parts.map((p) => `${head}\n\n${p}`) : [head];
}

async function upsertDoc(
  tx: Db,
  bucketId: string,
  syncId: string,
  doc: BucketUpsert,
): Promise<boolean> {
  const sha = bodySha(doc);
  const [prev] = await tx`
    select id, body_sha from bucket_docs
    where bucket_id = ${bucketId} and external_key = ${doc.key}
    for update
  `;
  const fields = {
    title: doc.title,
    url: doc.url ?? null,
    path: doc.path,
    version: doc.version == null ? null : String(doc.version),
    modified_at: doc.modified_at ?? null,
    metadata: jsonb(doc.metadata),
    last_sync_id: syncId,
  };
  if (prev && prev.body_sha === sha) {
    await tx`
      update bucket_docs set ${tx(fields)}, updated_at = now()
      where id = ${prev.id}
    `;
    return false;
  }
  const [row] = await tx`
    insert into bucket_docs ${tx({ ...fields, bucket_id: bucketId, external_key: doc.key, body: doc.text, body_sha: sha })}
    on conflict (bucket_id, external_key) do update set
      title = excluded.title, url = excluded.url, path = excluded.path,
      version = excluded.version, modified_at = excluded.modified_at,
      metadata = excluded.metadata, last_sync_id = excluded.last_sync_id,
      body = excluded.body, body_sha = excluded.body_sha,
      received_at = now(), updated_at = now()
    returning id
  `;
  await tx`delete from bucket_doc_chunks where doc_id = ${row.id}`;
  const chunks = bucketChunks(doc);
  await tx`
    insert into bucket_doc_chunks (doc_id, ordinal, chunk_text)
    select ${row.id}, u.ordinal, u.chunk_text
    from unnest(${chunks.map((_, i) => i)}::int[], ${chunks}::text[]) as u(ordinal, chunk_text)
  `;
  return true;
}

/**
 * Apply one batch in a single transaction: a batch is either all in or not at
 * all, so a pusher that retries a failed send never leaves half of one behind.
 * Chunks are written without vectors and the bucket.embed job fills them;
 * text search sees the batch as soon as this returns.
 */
export async function ingestBatch(
  bucket: IngestBucket,
  batch: BucketBatch,
): Promise<BucketBatchResult> {
  return sql.begin(async (tx) => {
    let upserted = 0;
    let unchanged = 0;
    for (const doc of batch.upserts) {
      if (await upsertDoc(tx, bucket.id, batch.sync_id, doc)) upserted++;
      else unchanged++;
    }

    const keys = batch.deletes.map((d) => d.key);
    const deleted = keys.length
      ? (
          await tx`
            delete from bucket_docs
            where bucket_id = ${bucket.id} and external_key = any(${keys})
            returning id
          `
        ).length
      : 0;

    // Only the final batch of a complete full sync sets prune: everything the
    // source still has was carried by this sync_id, so the rest is gone there.
    const pruned = batch.batch.prune
      ? (
          await tx`
            delete from bucket_docs
            where bucket_id = ${bucket.id}
              and last_sync_id is distinct from ${batch.sync_id}
            returning id
          `
        ).length
      : 0;

    await tx`
      update buckets set last_batch_at = now(), last_sync_id = ${batch.sync_id},
                         source = ${batch.source}
      where id = ${bucket.id}
    `;
    const [{ n }] = await tx`
      select count(*)::int as n from bucket_doc_chunks c
      join bucket_docs d on d.id = c.doc_id
      where d.bucket_id = ${bucket.id} and c.embedding is null
    `;
    if (n > 0)
      await enqueueRun({
        kind: "bucket.embed",
        params: { bucket_id: bucket.id },
        trigger: "event",
        db: tx,
      });
    return { upserted, unchanged, deleted, pruned, pending_chunks: n };
  }) as Promise<BucketBatchResult>;
}
