import { FlagEmbedding, EmbeddingModel } from "fastembed";

// all-MiniLM-L6-v2, 384-dim, local ONNX — no external API call.
export const EMBEDDING_DIM = 384;

let modelPromise: Promise<FlagEmbedding> | undefined;

// Lazy init — the ~90MB model loads only on first use, not at import time.
function model(): Promise<FlagEmbedding> {
  modelPromise ??= FlagEmbedding.init({
    model: EmbeddingModel.AllMiniLML6V2,
    cacheDir: process.env.FASTEMBED_CACHE ?? ".fastembed-cache",
  });
  return modelPromise;
}

const toArray = (v: Float32Array | number[]): number[] => Array.from(v);

// pgvector text input form: '[0.1,0.2,...]'
export const toVectorLiteral = (v: number[]): string => `[${v.join(",")}]`;

/** Embed a stored document (knowledge entry text). */
export async function embedPassage(text: string): Promise<number[]> {
  const m = await model();
  for await (const batch of m.passageEmbed([text], 1)) return toArray(batch[0]);
  throw new Error("embedPassage produced no vector");
}

/** Embed a search query. */
export async function embedQuery(text: string): Promise<number[]> {
  const m = await model();
  return toArray(await m.queryEmbed(text));
}
