import { env } from "../infra/env";
import { badInput } from "../infra/errors";
import { logContext } from "../infra/log";
import { EmbedQueue, type EmbedKind, type EmbedPriority } from "./embed-queue";
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
 * Where vectors come from. By default the model runs in this process, which is
 * right for the CLI, the tests and a standalone MCP server. The API hands its
 * embedding to a worker thread, and the MCP children it spawns send theirs to
 * the API over `TACHY_EMBED_URL`, so a host holds one copy of the model.
 */
export type EmbedBackend = (
  kind: EmbedKind,
  texts: string[],
  caller: string,
  priority?: EmbedPriority,
) => Promise<number[][]>;

const prepare = (text: string, prefix: string) =>
  prefix + text.slice(0, EMBEDDING_SPEC.maxChars);

async function runModel(texts: string[]): Promise<number[][]> {
  const extractor = await model();
  const tensor = (await extractor(texts, {
    pooling: EMBEDDING_SPEC.pooling,
    normalize: true,
  })) as { tolist(): number[][] };
  return tensor.tolist();
}

/** Texts per request to the embed endpoint, so its passage queue can interleave callers. */
const HTTP_CHUNK = 64;

function httpBackend(url: string, secret: string): EmbedBackend {
  return async (kind, texts, caller, priority) => {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += HTTP_CHUNK) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret}`,
          "x-tachy-caller": caller,
          "x-tachy-priority": priority ?? "normal",
        },
        body: JSON.stringify({ kind, texts: texts.slice(i, i + HTTP_CHUNK) }),
      });
      if (!response.ok)
        throw new Error(
          `embedding service answered ${response.status}: ${await response.text()}`,
        );
      vectors.push(
        ...((await response.json()) as { vectors: number[][] }).vectors,
      );
    }
    return vectors;
  };
}

function defaultBackend(): EmbedBackend {
  const url = process.env.TACHY_EMBED_URL;
  if (url) return httpBackend(url, process.env.TACHY_INTERNAL_SECRET ?? "");
  const local = new EmbedQueue(runModel, {
    passageBatch: 8,
    queryBatch: 32,
    batchBytes: EMBEDDING_SPEC.batchBytes,
  });
  return (kind, texts, caller, priority) =>
    local.embed(kind, texts, caller, priority);
}

let backend: EmbedBackend | undefined;

export function setEmbedBackend(next: EmbedBackend | undefined): void {
  backend = next;
}

/**
 * Passages from one request, one turn or one background job share a caller,
 * and the passage queue takes turns between callers.
 */
function currentCaller(): string {
  const ctx = logContext();
  return String(ctx?.req ?? env.turnId ?? `pid-${process.pid}`);
}

async function embed(kind: EmbedKind, texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  backend ??= defaultBackend();
  const vectors = await backend(
    kind,
    texts,
    currentCaller(),
    process.env.TACHY_EMBED_PRIORITY === "low" ? "low" : "normal",
  );
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

export async function embedPassage(text: string): Promise<number[]> {
  const [vector] = await embed("passage", [
    prepare(text, EMBEDDING_SPEC.passagePrefix),
  ]);
  return vector;
}

/** Vectors in the caller's order; the queue batches the passages by length. */
export const embedPassages = (texts: string[]): Promise<number[][]> =>
  embed(
    "passage",
    texts.map((t) => prepare(t, EMBEDDING_SPEC.passagePrefix)),
  );

export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embed("query", [
    prepare(text, EMBEDDING_SPEC.queryPrefix),
  ]);
  return vector;
}

/** Embed a query straight to the pgvector literal every search CTE binds. */
export const embedQueryLiteral = async (text: string): Promise<string> =>
  toVectorLiteral(await embedQuery(text));
