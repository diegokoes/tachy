import { parentPort } from "node:worker_threads";
import { EMBEDDING_SPEC, model } from "./model";

export interface EmbedRequest {
  id: number;
  texts: string[];
}

export type EmbedReply =
  | { type: "ready" }
  | { type: "result"; id: number; data: Float32Array; rows: number }
  | { type: "error"; id: number; error: string };

const port = parentPort!;
const pipe = await model();
port.postMessage({ type: "ready" } satisfies EmbedReply);

port.on("message", async ({ id, texts }: EmbedRequest) => {
  try {
    const out = (await pipe(texts, {
      pooling: EMBEDDING_SPEC.pooling,
      normalize: true,
    })) as { data: Float32Array; dims: number[] };
    const data = new Float32Array(out.data);
    port.postMessage(
      { type: "result", id, data, rows: out.dims[0] } satisfies EmbedReply,
      [data.buffer],
    );
  } catch (err) {
    port.postMessage({
      type: "error",
      id,
      error: String(err),
    } satisfies EmbedReply);
  }
});
