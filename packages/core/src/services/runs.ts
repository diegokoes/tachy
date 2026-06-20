import { sql } from "../db";

export interface RunInput {
  workItemId?: string | null;
  userId?: string | null;
  mode: string;                    // 'ingest' | 'consult' | 'sync'
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  meta?: Record<string, unknown>;
}

/** Record an analysis run for audit + token accounting. */
export async function recordRun(i: RunInput) {
  const [row] = await sql`
    insert into analysis_runs
      (work_item_id, user_id, mode, model, input_tokens, output_tokens, meta)
    values
      (${i.workItemId ?? null}, ${i.userId ?? null}, ${i.mode}, ${i.model ?? null},
       ${i.inputTokens ?? null}, ${i.outputTokens ?? null}, ${sql.json((i.meta ?? {}) as any)})
    returning id, mode, created_at
  `;
  return row;
}
