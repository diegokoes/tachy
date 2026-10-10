import { unitVector, vectorLiteral } from "./deterministic";

/**
 * Vectors for a window of rows, not for one row: the model runs over a batch.
 * The model is throughput-bound, so what moves the total is not embedding a
 * corpus at all: see `EMBED_MODES`. `offset` is the index of the window's first
 * row in its table, so the synthetic side stays keyed to the row, not to its
 * position in the window.
 */
export type Embedder = (
  kind: string,
  texts: string[],
  offset: number,
) => Promise<string[]>;

/** Which corpora get vectors from the real model. */
export const EMBED_MODES = ["none", "search", "all"] as const;
export type EmbedMode = (typeof EMBED_MODES)[number];

/**
 * `search` covers what a search reads. `code_blob_chunks` is most of the work
 * and is reached only by `search_code`, so it gets real vectors only when that
 * is the thing being measured. `ROWS_PER_SECOND` holds the rates.
 */
const REAL_KINDS: Record<EmbedMode, Set<string>> = {
  none: new Set(),
  search: new Set([
    "knowledge_entry",
    "reference_doc_chunk",
    "bucket_doc_chunk",
  ]),
  all: new Set([
    "knowledge_entry",
    "reference_doc_chunk",
    "bucket_doc_chunk",
    "code_chunk",
  ]),
};

/**
 * Rates measured on a 20-core workstation with fp32 bge-base through
 * onnxruntime-node, on the text this seeder writes, then scaled by 0.45: what
 * a ModernBERT-base encoder manages beside bge-base on code chunks. The model
 * saturates the cores it is given, so batching changes the constant and not the
 * order.
 */
const ROWS_PER_SECOND: Record<string, number> = {
  knowledge_entry: 15,
  reference_doc_chunk: 11,
  code_chunk: 9,
};

/** Roughly how long the real model will take, so an hour is never a surprise. */
export function embedEstimateSeconds(
  mode: EmbedMode,
  counts: Record<string, number>,
): number {
  let seconds = 0;
  for (const [kind, n] of Object.entries(counts))
    if (REAL_KINDS[mode].has(kind)) seconds += n / ROWS_PER_SECOND[kind];
  return Math.round(seconds);
}

export const syntheticEmbedder: Embedder = async (kind, texts, offset) =>
  texts.map((_, k) => vectorLiteral(unitVector(kind, offset + k)));

/**
 * The real model for the corpora `mode` names, synthetic vectors for the rest.
 * Deduplicated before batching: identical text has an identical vector, and a
 * seeded corpus repeats itself wherever a generator draws from a short list.
 */
export async function realEmbedder(
  mode: EmbedMode,
  onProgress?: (kind: string, done: number) => void,
): Promise<Embedder> {
  const { embedPassages, toVectorLiteral } = await import("@tachy/core/search");
  const done: Record<string, number> = {};

  return async (kind, texts, offset) => {
    if (!texts.length) return [];
    if (!REAL_KINDS[mode].has(kind))
      return syntheticEmbedder(kind, texts, offset);

    const seen = new Map<string, number>();
    const distinct: string[] = [];
    const at = texts.map((text) => {
      let slot = seen.get(text);
      if (slot === undefined) {
        slot = distinct.length;
        seen.set(text, slot);
        distinct.push(text);
      }
      return slot;
    });
    const literals = (await embedPassages(distinct)).map(toVectorLiteral);

    done[kind] = (done[kind] ?? 0) + texts.length;
    onProgress?.(kind, done[kind]);
    return at.map((i) => literals[i]);
  };
}

/**
 * Fill a window's `embedding` column, which `build` left holding the text to
 * embed. Keeping the text in the column it will occupy means the column list
 * stays the one the insert uses, with no scratch key to remember to strip.
 */
export const embedColumn =
  (embed: Embedder, kind: string) =>
  async (rows: Record<string, unknown>[], offset: number): Promise<void> => {
    const vectors = await embed(
      kind,
      rows.map((r) => r.embedding as string),
      offset,
    );
    rows.forEach((r, k) => (r.embedding = vectors[k]));
  };
