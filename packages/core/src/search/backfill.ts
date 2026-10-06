import { sql } from "../infra/db";
import { embedPassages, toVectorLiteral } from "./embeddings";
import { EMBEDDING_MODEL, LEGACY_EMBEDDING_MODEL } from "./model";

/**
 * True for a row whose vector the model in use made. Vectors of two models
 * share no space: a query embedded by one ranks the other's at random, with no
 * error. The vector legs read only these rows; a row of another model is
 * found by its words until the backfill reaches it.
 */
export const currentVector = (alias?: string) => {
  const column = alias
    ? sql`${sql(alias)}.embedding_model`
    : sql`embedding_model`;
  return sql`coalesce(${column}, ${LEGACY_EMBEDDING_MODEL}) = ${EMBEDDING_MODEL}`;
};

/** What a backfill has left: rows with no vector, or one of another model. */
export const needsVector = (alias?: string) => {
  const column = alias ? sql`${sql(alias)}.embedding` : sql`embedding`;
  return sql`(${column} is null or not ${currentVector(alias)})`;
};

/** Rows per embed-and-write round. Bounds memory on a full re-embed. */
export const EMBED_BATCH = 64;

export type EmbeddedTable =
  | "knowledge_entries"
  | "reference_doc_chunks"
  | "code_blob_chunks"
  | "bucket_doc_chunks";

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
      update ${sql(table)} t
      set embedding = v.vec::vector, embedding_model = ${EMBEDDING_MODEL}
      from (select unnest(${batch.map((r) => r.id)}::uuid[]) as id,
                   unnest(${vectors.map(toVectorLiteral)}::text[]) as vec) v
      where t.id = v.id
    `;
  }
  return rows.length;
}

const EMBEDDED_TABLES: EmbeddedTable[] = [
  "knowledge_entries",
  "reference_doc_chunks",
  "code_blob_chunks",
  "bucket_doc_chunks",
];

/** Vectors another model made, per table; see `currentVector`. */
export async function staleVectors(): Promise<
  { table: EmbeddedTable; rows: number }[]
> {
  const out: { table: EmbeddedTable; rows: number }[] = [];
  for (const table of EMBEDDED_TABLES) {
    const [{ n }] = await sql`
      select count(*)::int as n from ${sql(table)}
      where embedding is not null and not ${currentVector()}
    `;
    if (n) out.push({ table, rows: n });
  }
  return out;
}
