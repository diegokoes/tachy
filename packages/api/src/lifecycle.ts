import {
  schemaStampStatus,
  sql,
  type SchemaStampStatus,
} from "@tachy/core/infra";

/**
 * What /readyz answers from. The server flips `modelRequired` and `modelReady`
 * as it warms the embedding model, and `draining` on SIGTERM; tests build apps
 * against the defaults, where nothing is required.
 */
export const lifecycle = {
  draining: false,
  /** Set by an admin before maintenance: new chats are refused, all else serves. */
  refusingChats: false,
  modelRequired: false,
  modelReady: false,
  /** The embedder service's readiness URL, when the model is not in this process. */
  embedderUrl: undefined as string | undefined,
};

export interface Readiness {
  ready: boolean;
  database: boolean;
  schema: SchemaStampStatus | "unknown";
  model: "ready" | "loading" | "not_required" | "external" | "unreachable";
  draining: boolean;
}

export async function readiness(): Promise<Readiness> {
  let database = false;
  let schema: Readiness["schema"] = "unknown";
  try {
    await sql`select 1`;
    database = true;
    schema = await schemaStampStatus();
  } catch {}
  let model: Readiness["model"] = !lifecycle.modelRequired
    ? "not_required"
    : lifecycle.modelReady
      ? "ready"
      : "loading";
  if (lifecycle.embedderUrl)
    model = await fetch(lifecycle.embedderUrl, {
      signal: AbortSignal.timeout(2_000),
    })
      .then((r) => (r.ok ? "external" : "unreachable"))
      .catch(() => "unreachable" as const);
  return {
    ready:
      database &&
      schema !== "mismatch" &&
      model !== "loading" &&
      model !== "unreachable" &&
      !lifecycle.draining,
    database,
    schema,
    model,
    draining: lifecycle.draining,
  };
}

/**
 * Calls `onStuck` once the pool has had no connection free for `strikes`
 * probes in a row. A probe that waits past `timeoutMs` is queued behind a full
 * pool; one that fails has been answered, since Postgres being down fails at
 * once. Docker restarts a container that exits, not one that is unhealthy, so
 * a pool that never frees up otherwise leaves the process serving nothing.
 */
export function watchPool(opts: {
  onStuck: () => void;
  probe?: () => Promise<unknown>;
  everyMs?: number;
  timeoutMs?: number;
  strikes?: number;
}): () => void {
  const probe = opts.probe ?? (() => sql`select 1`);
  const everyMs = opts.everyMs ?? 30_000;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const strikes = opts.strikes ?? 6;
  let stuck = 0;
  const timer = setInterval(() => {
    void Promise.race([
      probe().then(
        () => true,
        () => true,
      ),
      new Promise<false>((r) => setTimeout(() => r(false), timeoutMs).unref()),
    ]).then((answered) => {
      stuck = answered ? 0 : stuck + 1;
      if (stuck < strikes) return;
      clearInterval(timer);
      opts.onStuck();
    });
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
