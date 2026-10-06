import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { embedThreads } from "./threads";

/**
 * Per-model facts the library does not default correctly. Wrong pooling or
 * prefixes raise no error: every vector collapses toward a narrow cone and
 * unrelated text scores as high as a match.
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
   * Tokens of one input the model reads; the rest is dropped. Attention costs
   * memory by the square of this, so it is set here and not left to the
   * tokenizer's own limit, which a model's files may leave unset.
   */
  maxTokens: number;
  /**
   * UTF-8 bytes one batch may hold, beside its limit on texts. It bounds how
   * long a batch occupies the model, which is how long a search can wait
   * behind one, and how far the runtime's arena grows.
   */
  batchBytes: number;
  /**
   * The longest code chunk the model reads whole, its path line included:
   * under `maxTokens` at 2.7 characters a token, code's tenth percentile.
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
  /**
   * The default: a general text model that also ranks code, so tickets and
   * code share one. CLS-pooled, no prefixes
   * (https://huggingface.co/Alibaba-NLP/gte-modernbert-base). Its figures
   * against the other models are in DEPLOYMENT-ARCHITECTURE.md.
   */
  "Alibaba-NLP/gte-modernbert-base": {
    dim: 768,
    pooling: "cls",
    queryPrefix: "",
    passagePrefix: "",
    maxChars: 8000,
    // Its tokenizer_config.json sets model_max_length to 1e30, so nothing else
    // truncates, and base64 or CJK input runs past one token a character.
    // Unbounded, a batch of long passages outgrows the embedder's memory limit.
    maxTokens: 1024,
    // One full code chunk: this model embeds faster in smaller batches, and a
    // search waits behind one batch at most.
    batchBytes: 2500,
    codeChunkChars: 2400,
    semFloor: 0.57,
    semCeil: 0.8,
    codeSemFloor: 0.6,
  },
  /**
   * CLS-pooled, 512-token window. No query prefix: the instruction its model
   * card offers dominates the vector of a content-free query and pulls
   * nonsense toward every entry. Run `scripts/eval-embeddings.ts` before
   * adding one.
   */
  "Xenova/bge-base-en-v1.5": {
    dim: 768,
    pooling: "cls",
    queryPrefix: "",
    passagePrefix: "",
    maxChars: 2000,
    maxTokens: 512,
    batchBytes: 16000,
    codeChunkChars: 1300,
    semFloor: 0.6,
    semCeil: 0.75,
    codeSemFloor: 0.6,
  },
  /**
   * Mean-pooled, symmetric. Its floor and ceiling are copied from bge-base:
   * run `scripts/eval-embeddings.ts` before selecting it.
   */
  "Xenova/gte-base": {
    dim: 768,
    pooling: "mean",
    queryPrefix: "",
    passagePrefix: "",
    maxChars: 2000,
    maxTokens: 512,
    batchBytes: 16000,
    codeChunkChars: 1300,
    semFloor: 0.6,
    semCeil: 0.75,
    codeSemFloor: 0.6,
  },
  /**
   * Mean-pooled reference small model. 384-dim: the vector columns must be
   * narrowed before it can be selected.
   */
  "Xenova/all-MiniLM-L6-v2": {
    dim: 384,
    pooling: "mean",
    queryPrefix: "",
    passagePrefix: "",
    maxChars: 1500,
    maxTokens: 512,
    batchBytes: 12000,
    codeChunkChars: 650,
    semFloor: 0.6,
    semCeil: 0.75,
    codeSemFloor: 0.6,
  },
};

export const EMBEDDING_MODEL =
  process.env.TACHY_EMBED_MODEL ?? "Alibaba-NLP/gte-modernbert-base";

/** A row with no `embedding_model` holds a vector from this model. */
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
  // A rejected promise is not memoized: one failed download would disable
  // embeddings for the life of the process. Imported here so a process that
  // embeds over HTTP never loads the ONNX runtime.
  modelPromise ??= import("@huggingface/transformers")
    .then(async ({ pipeline, env: hfEnv }) => {
      hfEnv.cacheDir = process.env.TACHY_MODEL_CACHE ?? ".model-cache";
      const threads = embedThreads();
      const pipe = await pipeline("feature-extraction", EMBEDDING_MODEL, {
        dtype: "fp32",
        session_options: {
          ...(threads && { intraOpNumThreads: threads }),
          // An idle thread spins before it sleeps, and a CPU quota counts the
          // spin as use.
          extra: { session: { intra_op: { allow_spinning: "0" } } },
        },
      });
      // The pipeline truncates at the tokenizer's model_max_length and takes
      // no other length.
      Object.defineProperty(pipe.tokenizer, "model_max_length", {
        value: EMBEDDING_SPEC.maxTokens,
      });
      return pipe;
    })
    .catch((e) => {
      modelPromise = undefined;
      throw e;
    });
  return modelPromise;
}
