import {
  pipeline,
  env as hfEnv,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";

/**
 * Pooling and prefixes are per-model facts, not library defaults. Getting them
 * wrong does not fail — it silently collapses every vector toward a narrow cone,
 * so unrelated text scores as high as a real match. They live here, in data, so
 * a model swap is a table entry rather than a hidden assumption.
 */
export interface EmbeddingModelSpec {
  dim: number;
  pooling: "cls" | "mean";
  /** Prepended to search queries only. Empty for symmetric models. */
  queryPrefix: string;
  /** Prepended to stored documents only. */
  passagePrefix: string;
  /** Input is truncated here; the model window is 512 tokens. */
  maxChars: number;
}

export const EMBEDDING_MODELS: Record<string, EmbeddingModelSpec> = {
  // CLS-pooled, no prefix on either side. The card offers an optional query
  // instruction ("Represent this sentence for searching relevant passages: ")
  // and notes omitting it costs only "a slight degradation". Measured on this
  // corpus it costs nothing and helps: a constant prefix is most of the vector
  // for a content-free query, which lifts nonsense toward everything. With the
  // instruction, "ñ" scored 0.487 against a real entry while a true identifier
  // match scored 0.460 — nonsense outranking a hit. Without it, vector-only
  // top-1 over the golden set went 12/13 -> 13/13. Re-derive with
  // scripts/eval-embeddings.ts before changing this back.
  "Xenova/bge-base-en-v1.5": {
    dim: 768,
    pooling: "cls",
    queryPrefix: "",
    passagePrefix: "",
    maxChars: 2000,
  },
  // Mean-pooled, symmetric, no prefixes on either side.
  "Xenova/gte-base": {
    dim: 768,
    pooling: "mean",
    queryPrefix: "",
    passagePrefix: "",
    maxChars: 2000,
  },
  // Mean-pooled. Kept as the reference small model; 384-dim, so it needs the
  // vector columns narrowed before it can be selected.
  "Xenova/all-MiniLM-L6-v2": {
    dim: 384,
    pooling: "mean",
    queryPrefix: "",
    passagePrefix: "",
    maxChars: 1500,
  },
};

export const EMBEDDING_MODEL =
  process.env.TACHY_EMBED_MODEL ?? "Xenova/bge-base-en-v1.5";

export const EMBEDDING_SPEC: EmbeddingModelSpec = (() => {
  const spec = EMBEDDING_MODELS[EMBEDDING_MODEL];
  if (!spec)
    throw new Error(
      `Unknown TACHY_EMBED_MODEL '${EMBEDDING_MODEL}'. Known: ${Object.keys(EMBEDDING_MODELS).join(", ")}`,
    );
  return spec;
})();

/** Must match the vector(N) columns in db/schema.sql. */
export const EMBEDDING_DIM = 768;

if (EMBEDDING_SPEC.dim !== EMBEDDING_DIM)
  throw new Error(
    `Model '${EMBEDDING_MODEL}' produces ${EMBEDDING_SPEC.dim}-dim vectors but the schema stores vector(${EMBEDDING_DIM}). ` +
      `Change the vector(N) columns in db/schema.sql and EMBEDDING_DIM together, then re-embed with 'npm run sync reembed'.`,
  );

hfEnv.cacheDir = process.env.TACHY_MODEL_CACHE ?? ".model-cache";

let modelPromise: Promise<FeatureExtractionPipeline> | undefined;

export function model(): Promise<FeatureExtractionPipeline> {
  // A rejected promise must not be memoized: one transient download failure
  // would otherwise disable embeddings for the whole process lifetime.
  modelPromise ??= pipeline("feature-extraction", EMBEDDING_MODEL, {
    dtype: "fp32",
  }).catch((e) => {
    modelPromise = undefined;
    throw e;
  });
  return modelPromise;
}
