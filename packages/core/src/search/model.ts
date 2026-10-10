import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { embedThreads } from "./threads";

/**
 * Per-model facts the library does not default correctly. Wrong pooling or
 * prefixes raise no error: every vector collapses toward a narrow cone and
 * unrelated text scores as high as a match.
 */
export interface EmbeddingModelSpec {
  /** Values stored per vector: the width of the vector(N) columns. */
  dim: number;
  pooling: "cls" | "mean" | "last_token";
  /**
   * The Hugging Face repository holding the ONNX files, when the registry key
   * is not one: a model published without them, or a variant of another entry.
   */
  source?: string;
  /**
   * The commit of that repository the files are read at. Unset, its `main`:
   * an upload there then changes the vectors under the same name.
   */
  revision?: string;
  /**
   * Which ONNX file computes: full precision unless set. An int8 file gives
   * other vectors than its fp32 parent, so it is an entry of its own.
   */
  dtype?: "fp32" | "q8";
  /**
   * The model's vector is wider than `dim`, and it is trained so the leading
   * `dim` values are a vector of their own once brought to unit length.
   */
  matryoshka?: boolean;
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

/**
 * English only: a ticket in another language is matched on the words it
 * shares with an entry. CLS-pooled, no prefixes
 * (https://huggingface.co/Alibaba-NLP/gte-modernbert-base).
 */
const GTE_MODERNBERT: EmbeddingModelSpec = {
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
};

/**
 * What a candidate starts from: gte-modernbert-base's window, batch size and
 * floors. An entry that sets no floor of its own is unmeasured: run
 * `scripts/eval-embeddings.ts` and `scripts/eval-code-search.ts` before
 * selecting it.
 */
const UNMEASURED = {
  dim: 768,
  maxChars: 8000,
  maxTokens: 1024,
  batchBytes: 2500,
  codeChunkChars: 2400,
  semFloor: 0.57,
  semCeil: 0.8,
  codeSemFloor: 0.6,
} as const;

/**
 * The default: one general model for tickets and code, and multilingual, so
 * a ticket finds an entry written in another language. It is
 * gte-modernbert-base's encoder under a larger vocabulary. CLS-pooled, and
 * both sides take a prefix (https://huggingface.co/lightonai/mDenseOn). Its
 * figures against the other models are in DEPLOYMENT-ARCHITECTURE.md.
 */
const MDENSEON: EmbeddingModelSpec = {
  ...UNMEASURED,
  // lightonai publishes no ONNX file. This repository holds an export of
  // theirs, and its README says how it was made.
  source: "diegomo123/mDenseOn-ONNX",
  revision: "5efec33f513509644b7e7093d572f72fea1e09b7",
  pooling: "cls",
  queryPrefix: "query: ",
  passagePrefix: "document: ",
  semFloor: 0.41,
  semCeil: 0.6,
  codeSemFloor: 0.4,
};

/**
 * A decoder, so the last token carries the text and a query names its task.
 * 1024 values, cut to the schema's width
 * (https://huggingface.co/Qwen/Qwen3-Embedding-0.6B). The instruction is its
 * card's: with none a meaningless query outscores a real match, and one that
 * names tachý's content narrows the gap between them.
 */
const QWEN3_SMALL: EmbeddingModelSpec = {
  ...UNMEASURED,
  source: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
  pooling: "last_token",
  matryoshka: true,
  queryPrefix:
    "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:",
  passagePrefix: "",
  semFloor: 0.35,
  semCeil: 0.7,
  codeSemFloor: 0.45,
};

export const EMBEDDING_MODELS: Record<string, EmbeddingModelSpec> = {
  "Alibaba-NLP/gte-modernbert-base": GTE_MODERNBERT,
  /**
   * The int8 file of the entry above: faster and smaller, and it ranks
   * tickets a little worse. Its code floor is the fp32 file's, unmeasured.
   */
  "Alibaba-NLP/gte-modernbert-base:q8": {
    ...GTE_MODERNBERT,
    source: "Alibaba-NLP/gte-modernbert-base",
    dtype: "q8",
  },
  "lightonai/mDenseOn": MDENSEON,
  "Qwen/Qwen3-Embedding-0.6B": QWEN3_SMALL,
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
  process.env.TACHY_EMBED_MODEL ?? "lightonai/mDenseOn";

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
      const extractor = await pipeline(
        "feature-extraction",
        EMBEDDING_SPEC.source ?? EMBEDDING_MODEL,
        {
          dtype: EMBEDDING_SPEC.dtype ?? "fp32",
          revision: EMBEDDING_SPEC.revision ?? "main",
          session_options: {
            ...(threads && { intraOpNumThreads: threads }),
            // An idle thread spins before it sleeps, and a CPU quota counts
            // the spin as use.
            extra: { session: { intra_op: { allow_spinning: "0" } } },
          },
        },
      );
      // The pipeline truncates at the tokenizer's model_max_length and takes
      // no other length.
      Object.defineProperty(extractor.tokenizer, "model_max_length", {
        value: EMBEDDING_SPEC.maxTokens,
      });
      return extractor;
    })
    .catch((e) => {
      modelPromise = undefined;
      throw e;
    });
  return modelPromise;
}

/** `rows` vectors of `EMBEDDING_DIM` values each, one after another. */
export interface EncodedTexts {
  /** Backed by a buffer of its own, so a thread can hand it over. */
  data: Float32Array<ArrayBuffer>;
  rows: number;
}

/**
 * The first `dim` values of each `width`-wide row, at unit length: a cut
 * vector is shorter than one, and cosine distance expects one.
 */
export function leadingUnit(
  data: Float32Array,
  width: number,
  dim: number,
): Float32Array<ArrayBuffer> {
  const rows = data.length / width;
  const cut = new Float32Array(rows * dim);
  for (let r = 0; r < rows; r++) {
    const row = data.subarray(r * width, r * width + dim);
    const norm = Math.hypot(...row) || 1;
    for (let k = 0; k < dim; k++) cut[r * dim + k] = row[k] / norm;
  }
  return cut;
}

export const vectorRows = ({
  data,
  rows,
}: {
  data: Float32Array;
  rows: number;
}): number[][] =>
  Array.from({ length: rows }, (_, r) =>
    Array.from(data.subarray(r * EMBEDDING_DIM, (r + 1) * EMBEDDING_DIM)),
  );

/** Prepared texts in, one unit vector each, in the order given. */
export async function encode(texts: string[]): Promise<EncodedTexts> {
  const extractor = await model();
  const tensor = (await extractor(texts, {
    pooling: EMBEDDING_SPEC.pooling,
    normalize: true,
  })) as { data: Float32Array; dims: number[] };
  const [rows, width] = tensor.dims;
  // A copy either way: the tensor's buffer belongs to the runtime.
  const data = EMBEDDING_SPEC.matryoshka
    ? leadingUnit(tensor.data, width, EMBEDDING_DIM)
    : new Float32Array(tensor.data);
  return { data, rows };
}
