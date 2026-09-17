import { badInput } from "../infra/errors";
import { model, EMBEDDING_DIM, EMBEDDING_MODEL, EMBEDDING_SPEC } from "./model";

export {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  EMBEDDING_MODELS,
  EMBEDDING_SPEC,
} from "./model";
export type { EmbeddingModelSpec } from "./model";

export const toVectorLiteral = (v: number[]): string => `[${v.join(",")}]`;

/**
 * Eight, not more: on 8 threads larger batches were no faster, but held the
 * event loop proportionally longer and grew the ONNX arena, which never shrinks
 * (measured in DEPLOYMENT-ARCHITECTURE.md §3.1).
 */
const PASSAGE_BATCH = 8;

const prepare = (text: string, prefix: string) =>
  prefix + text.slice(0, EMBEDDING_SPEC.maxChars);

async function run(texts: string[]): Promise<number[][]> {
  const m = await model();
  const out = (await m(texts, {
    pooling: EMBEDDING_SPEC.pooling,
    normalize: true,
  })) as { tolist(): number[][] };
  const vectors = out.tolist();
  if (vectors.length !== texts.length)
    throw badInput(
      `embedding produced ${vectors.length} vectors for ${texts.length} inputs`,
    );
  if (vectors[0].length !== EMBEDDING_DIM)
    throw badInput(
      `model '${EMBEDDING_MODEL}' produced ${vectors[0].length}-dim vectors, expected ${EMBEDDING_DIM}`,
    );
  return vectors;
}

/** Embed a stored document (knowledge entry text). */
export async function embedPassage(text: string): Promise<number[]> {
  const [v] = await run([prepare(text, EMBEDDING_SPEC.passagePrefix)]);
  return v;
}

/**
 * Embed many passages in model-sized batches (doc chunks).
 *
 * Batched by length, not by input order. A batch is padded to its longest
 * member and the transformer pays for the padding, so one 400-token passage
 * beside seven short ones costs the same as eight long ones. Grouping similar
 * lengths together removes most of that; the result is returned in the caller's
 * order, so the sort is invisible.
 */
export async function embedPassages(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const order = texts
    .map((t, i) => i)
    .sort((a, b) => texts[a].length - texts[b].length);

  const out = new Array<number[]>(texts.length);
  for (let i = 0; i < order.length; i += PASSAGE_BATCH) {
    const idx = order.slice(i, i + PASSAGE_BATCH);
    const vectors = await run(
      idx.map((j) => prepare(texts[j], EMBEDDING_SPEC.passagePrefix)),
    );
    idx.forEach((j, k) => (out[j] = vectors[k]));
  }
  return out;
}

/** Embed a search query. */
export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await run([prepare(text, EMBEDDING_SPEC.queryPrefix)]);
  return v;
}

/** Embed a query straight to the pgvector literal every search CTE binds. */
export const embedQueryLiteral = async (text: string): Promise<string> =>
  toVectorLiteral(await embedQuery(text));
