import { sql, jsonb } from "../infra/db";

export interface FeedbackInput {
  knowledgeEntryId: string;
  userId?: string | null;
  kind?: string;
  rating?: number | null;
  comment?: string | null;
  patch?: Record<string, unknown> | null;
}

export async function addFeedback(input: FeedbackInput) {
  const [row] = await sql`
    insert into knowledge_feedback
      (knowledge_entry_id, user_id, kind, rating, comment, patch)
    values
      (${input.knowledgeEntryId}, ${input.userId ?? null}, ${input.kind ?? "note"}, ${input.rating ?? null},
       ${input.comment ?? null}, ${input.patch ? jsonb(input.patch) : null})
    returning id, kind, created_at
  `;
  return row;
}

export async function listFeedback(knowledgeEntryId: string) {
  return sql`
    select id, user_id, kind, rating, comment, patch, created_at
    from knowledge_feedback
    where knowledge_entry_id = ${knowledgeEntryId}
    order by created_at asc
  `;
}
