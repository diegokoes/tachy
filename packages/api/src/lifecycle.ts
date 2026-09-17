import { schemaStampStatus, sql, type SchemaStampStatus } from "@tachy/core";

/**
 * What /readyz answers from. The server flips `modelRequired` and `modelReady`
 * as it warms the embedding model, and `draining` on SIGTERM; tests build apps
 * against the defaults, where nothing is required.
 */
export const lifecycle = {
  draining: false,
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
