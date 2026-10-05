import type { FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Pooling and prefixes are per-model facts, not library defaults. Getting them
 * wrong does not fail - it silently collapses every vector toward a narrow cone,
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
  /** Input is cut here before it reaches the tokenizer. */
  maxChars: number;
  /**
   * Characters one passage batch may hold, beside the limit of eight texts.
   * It bounds how long a batch occupies the model, which is how long a search
   * can wait behind one, and how far the runtime's arena grows.
   */
  batchChars: number;
  /**
   * The longest code chunk the model reads whole, its path line included.
   * Code runs about 3 characters a token, 2.7 at the tenth percentile
   * (measured on tachý's own source), so a 512-token window holds about 1350.
   * Past this a chunk's tail is stored and never embedded.
   */
  codeChunkChars: number;
  /**
   * Cosine below which a vector match is noise, and where real matches top
   * out. Raw cosine is not a relevance percentage and never starts at zero,
   * and each model compresses its range differently, so these are measured
   * per model: scripts/eval-embeddings.ts prints them, and
   * test/search/quality.test.ts fails when they no longer fit.
   */
  semFloor: number;
  semCeil: number;
  /**
   * The floor of code search's vector leg. Code is another distribution:
   * meaningless queries score higher against it than against tickets.
   */
  codeSemFloor: number;
}

export const EMBEDDING_MODELS: Record<string, EmbeddingModelSpec> = {
  // The default. A general text model that also ranks code well, with an
  // 8192-token window, so tickets and code share one model and no chunk is
  // read in part. CLS-pooled, no prefixes
  // (https://huggingface.co/Alibaba-NLP/gte-modernbert-base). On the 45
  // questions of test/fixtures/code-golden.ts its vectors alone put the right
  // file first 28 times, against 12 for bge-base and 16 for
  // jina-embeddings-v2-base-code; all three score 13 of 13 on the ticket set.
  // It embeds at about half bge-base's rate.
  //
  // Nonsense scores <= 0.541 against the golden corpus and genuine matches
  // >= 0.655, topping out at 0.769. A terse paraphrase scores lower than the
  // golden set's: "scanner offline" reaches a barcode-reader entry at 0.592,
  // so the floor sits between that and what nonsense reaches. Against code,
  // nonsense reaches 0.579 and a question's own file 0.637 at the 25th
  // percentile.
  "Alibaba-NLP/gte-modernbert-base": {
    dim: 768,
    pooling: "cls",
    queryPrefix: "",
    passagePrefix: "",
    maxChars: 8000,
    // Two full code chunks: 1.4 s on 8 CPUs and 1.75 GB at peak, against
    // 5.8 s and 2.5 GB for eight, and it embeds faster.
    batchChars: 5000,
    codeChunkChars: 2400,
    semFloor: 0.57,
    semCeil: 0.8,
    codeSemFloor: 0.6,
  },
  // CLS-pooled, no prefix on either side. The model card offers an optional
  // query instruction ("Represent this sentence for searching relevant
  // passages: ") and says omitting it costs "a slight degradation". On this
  // corpus the instruction hurts: a constant prefix dominates the vector of a
  // content-free query and pulls nonsense toward every entry. With it, "ñ"
  // scores 0.487 against a real entry and a true identifier match 0.460.
  // Without it, vector-only top-1 on the golden set is 13/13, against 12/13.
  // Re-run scripts/eval-embeddings.ts before adding a prefix.
  //
  // Its window is 512 tokens. Nonsense scores <= 0.567 against the golden
  // corpus and genuine matches >= 0.654, topping out at 0.720.
  "Xenova/bge-base-en-v1.5": {
    dim: 768,
    pooling: "cls",
    queryPrefix: "",
    passagePrefix: "",
    maxChars: 2000,
    batchChars: 16000,
    codeChunkChars: 1300,
    semFloor: 0.6,
    semCeil: 0.75,
    codeSemFloor: 0.6,
  },
  // Mean-pooled, symmetric, no prefixes on either side. Its floor and ceiling
  // are bge-base's, not measured: re-run the eval before selecting it.
  "Xenova/gte-base": {
    dim: 768,
    pooling: "mean",
    queryPrefix: "",
    passagePrefix: "",
    maxChars: 2000,
    batchChars: 16000,
    codeChunkChars: 1300,
    semFloor: 0.6,
    semCeil: 0.75,
    codeSemFloor: 0.6,
  },
  // Mean-pooled. Kept as the reference small model; 384-dim, so it needs the
  // vector columns narrowed before it can be selected.
  "Xenova/all-MiniLM-L6-v2": {
    dim: 384,
    pooling: "mean",
    queryPrefix: "",
    passagePrefix: "",
    maxChars: 1500,
    batchChars: 12000,
    codeChunkChars: 650,
    semFloor: 0.6,
    semCeil: 0.75,
    codeSemFloor: 0.6,
  },
};

export const EMBEDDING_MODEL =
  process.env.TACHY_EMBED_MODEL ?? "Alibaba-NLP/gte-modernbert-base";

/**
 * What made every vector stored before rows named their model. A row with no
 * `embedding_model` is taken to be this one's.
 */
export const LEGACY_EMBEDDING_MODEL = "Xenova/bge-base-en-v1.5";

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

let modelPromise: Promise<FeatureExtractionPipeline> | undefined;

export function model(): Promise<FeatureExtractionPipeline> {
  // A rejected promise must not be memoized: one transient download failure
  // would otherwise disable embeddings for the whole process lifetime.
  // Imported here, not at the top: a process that embeds over HTTP never loads
  // the ONNX runtime at all.
  modelPromise ??= import("@huggingface/transformers")
    .then(({ pipeline, env: hfEnv }) => {
      hfEnv.cacheDir = process.env.TACHY_MODEL_CACHE ?? ".model-cache";
      return pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "fp32" });
    })
    .catch((e) => {
      modelPromise = undefined;
      throw e;
    });
  return modelPromise;
}
