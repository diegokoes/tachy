import { Worker } from "node:worker_threads";
import { log } from "../infra/log";
import { EMBEDDING_DIM } from "./model";
import { EmbedQueue } from "./embed-queue";
import type { EmbedReply, EmbedRequest } from "./embed-thread";

export interface EmbedHost {
  queue: EmbedQueue;
  stop(): Promise<void>;
}

/** Thrown while the model thread is (re)starting; the caller may retry. */
export class EmbedderUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbedderUnavailable";
  }
}

function spawn(): Worker {
  const compiled = !import.meta.url.endsWith(".ts");
  const url = new URL(
    compiled ? "./embed-thread.js" : "./embed-thread.ts",
    import.meta.url,
  );
  const tsx =
    url.pathname.endsWith(".ts") &&
    !process.execArgv.some((a) => a.includes("tsx"));
  return new Worker(url, {
    execArgv: [...process.execArgv, ...(tsx ? ["--import", "tsx"] : [])],
  });
}

/**
 * Loads the embedding model once, in a worker thread, so encoding never blocks
 * the event loop that serves requests. A thread that dies is restarted; one
 * that fails to load `maxLoadFailures` times in a row is fatal, since a server
 * that cannot search should exit and be restarted rather than sit unhealthy.
 */
export function startEmbedHost(opts: {
  onReady?: (ready: boolean) => void;
  onFatal?: (err: Error) => void;
  maxLoadFailures?: number;
}): EmbedHost {
  const maxLoadFailures = opts.maxLoadFailures ?? 3;
  let worker: Worker | undefined;
  let ready = false;
  let stopped = false;
  let loadFailures = 0;
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: number[][]) => void; reject: (e: unknown) => void }
  >();

  const setReady = (value: boolean) => {
    ready = value;
    opts.onReady?.(value);
  };

  const start = () => {
    const w = spawn();
    worker = w;
    w.on("message", (msg: EmbedReply) => {
      if (msg.type === "ready") {
        loadFailures = 0;
        setReady(true);
        log("info", "embedding_model_ready", {});
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.type === "error") return p.reject(new Error(msg.error));
      const vectors: number[][] = [];
      for (let r = 0; r < msg.rows; r++)
        vectors.push(
          Array.from(
            msg.data.subarray(r * EMBEDDING_DIM, (r + 1) * EMBEDDING_DIM),
          ),
        );
      p.resolve(vectors);
    });
    w.on("error", (err) =>
      log("error", "embedding_thread_error", { error: String(err) }),
    );
    w.on("exit", (code) => {
      const wasReady = ready;
      setReady(false);
      for (const p of pending.values())
        p.reject(new EmbedderUnavailable("embedding thread restarted"));
      pending.clear();
      if (stopped) return;
      if (!wasReady && ++loadFailures >= maxLoadFailures) {
        opts.onFatal?.(
          new Error(`embedding model failed to load ${loadFailures} times`),
        );
        return;
      }
      log("warn", "embedding_thread_exit", { code, restarting: true });
      setTimeout(start, 1_000).unref();
    });
  };

  const queue = new EmbedQueue(
    (texts) =>
      new Promise((resolve, reject) => {
        if (!ready || !worker)
          return reject(
            new EmbedderUnavailable("embedding model is still loading"),
          );
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, texts } satisfies EmbedRequest);
      }),
  );

  start();
  return {
    queue,
    async stop() {
      stopped = true;
      await worker?.terminate();
    },
  };
}
