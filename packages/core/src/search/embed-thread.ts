import { parentPort } from "node:worker_threads";
import { encode, model } from "./model";

export interface EmbedRequest {
  id: number;
  texts: string[];
}

export type EmbedReply =
  | { type: "ready" }
  | { type: "result"; id: number; data: Float32Array; rows: number }
  | { type: "error"; id: number; error: string };

const port = parentPort!;
await model();
port.postMessage({ type: "ready" } satisfies EmbedReply);

port.on("message", async ({ id, texts }: EmbedRequest) => {
  try {
    const { data, rows } = await encode(texts);
    port.postMessage({ type: "result", id, data, rows } satisfies EmbedReply, [
      data.buffer,
    ]);
  } catch (err) {
    port.postMessage({
      type: "error",
      id,
      error: String(err),
    } satisfies EmbedReply);
  }
});
