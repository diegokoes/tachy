import { sql } from "@tachy/core";

export { sql };



export async function resetData() {
  await sql`
    truncate work_item_messages, work_items, knowledge_feedback,
             knowledge_entries, analysis_runs, team_members, users,
             customers, resolution_patterns, components, labels,
             reference_docs, reference_doc_chunks, settings
    restart identity cascade
  `;
}


export async function seededFreshdeskConnId(): Promise<string> {
  const [row] = await sql`select id from source_connections where slug = 'test-freshdesk'`;
  return row.id as string;
}

export async function tpdProductId(): Promise<string> {
  const [row] = await sql`select id from products where slug = 'tpd'`;
  return row.id as string;
}
