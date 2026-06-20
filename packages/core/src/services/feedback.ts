import { sql } from "../db";

export interface FeedbackInput {
  knowledgeEntryId: string;
  userId?: string | null;
  kind?: string;                   // 'correction' | 'rating' | 'note' (default 'note')
  rating?: number | null;          // optional 1..5
  comment?: string | null;
  patch?: Record<string, unknown> | null;  // proposed field changes
}

/** Record human feedback (correction / rating / note) on a knowledge entry. */
export async function addFeedback(i: FeedbackInput) {
  const [row] = await sql`
    insert into knowledge_feedback
      (knowledge_entry_id, user_id, kind, rating, comment, patch)
    values
      (${i.knowledgeEntryId}, ${i.userId ?? null}, ${i.kind ?? "note"}, ${i.rating ?? null},
       ${i.comment ?? null}, ${i.patch ? sql.json(i.patch as any) : null})
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
