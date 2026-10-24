import { createHash } from "node:crypto";
import { sql } from "../infra/db";
import { embedQueryLiteral } from "../search/embeddings";
import { EMBEDDING_MODEL } from "../search/model";

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

/**
 * The query vector of each of a ticket's search windows, in their order. A
 * window embedded at an earlier open is read back; the rest are embedded one
 * request each, since the embedder runs a request as one batch and every other
 * search waits behind it. The item then keeps the vectors of these windows only.
 */
export async function ticketQueryVectors(
  workItemId: string,
  windows: string[],
): Promise<string[]> {
  const hashes = windows.map(sha256);
  const stored = await sql<{ text_sha256: string; embedding: string }[]>`
    select text_sha256, embedding::text as embedding
    from work_item_query_vectors
    where work_item_id = ${workItemId} and embedding_model = ${EMBEDDING_MODEL}
      and text_sha256 = any(${hashes})
  `;
  const vectors = new Map(
    stored.map((row) => [row.text_sha256, row.embedding]),
  );
  const added: { hash: string; vector: string }[] = [];
  for (const [i, window] of windows.entries()) {
    if (vectors.has(hashes[i])) continue;
    const vector = await embedQueryLiteral(window);
    vectors.set(hashes[i], vector);
    added.push({ hash: hashes[i], vector });
  }
  await sql.begin(async (tx) => {
    await tx`
      delete from work_item_query_vectors
      where work_item_id = ${workItemId}
        and not (embedding_model = ${EMBEDDING_MODEL} and text_sha256 = any(${hashes}))
    `;
    if (!added.length) return;
    await tx`
      insert into work_item_query_vectors (work_item_id, text_sha256, embedding_model, embedding)
      select ${workItemId}, v.hash, ${EMBEDDING_MODEL}, v.vector::vector
      from unnest(${added.map((a) => a.hash)}::text[], ${added.map((a) => a.vector)}::text[]) as v(hash, vector)
      on conflict do nothing
    `;
  });
  return hashes.map((hash) => vectors.get(hash)!);
}
