import { sql } from "../infra/db";
import { embedPassages, toVectorLiteral } from "./embeddings";

/** Rows per embed-and-write round. Bounds memory on a full re-embed. */
export const EMBED_BATCH = 64;

export type EmbeddedTable =
  "knowledge_entries" | "reference_doc_chunks" | "code_chunks";

/**
 * Embed each row's text and write the vector to `embedding` on the row with
 * the same id, EMBED_BATCH rows at a time. Returns the number of rows written.
 */
export async function writeEmbeddings(
  table: EmbeddedTable,
  rows: { id: string; text: string }[],
): Promise<number> {
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH);
    const vectors = await embedPassages(batch.map((r) => r.text));
    await sql`
      update ${sql(table)} t set embedding = v.vec::vector
      from (select unnest(${batch.map((r) => r.id)}::uuid[]) as id,
                   unnest(${vectors.map(toVectorLiteral)}::text[]) as vec) v
      where t.id = v.id
    `;
  }
  return rows.length;
}
