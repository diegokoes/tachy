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
};

export interface Readiness {
  ready: boolean;
  database: boolean;
  schema: SchemaStampStatus | "unknown";
  model: "ready" | "loading" | "not_required";
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
  const model = !lifecycle.modelRequired
    ? "not_required"
    : lifecycle.modelReady
      ? "ready"
      : "loading";
  return {
    ready:
      database &&
      schema !== "mismatch" &&
      model !== "loading" &&
      !lifecycle.draining,
    database,
    schema,
    model,
    draining: lifecycle.draining,
  };
}
