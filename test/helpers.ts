import { sql } from "@tachy/core";

export { sql };

// Wipe the mutable tables between tests while keeping the org/source seed
// (teams, products, source_connections, source_product_map) from schema.sql.
export async function resetData() {
  await sql`
    truncate work_item_messages, work_items, knowledge_feedback,
             knowledge_entries, analysis_runs, team_members, users
    restart identity cascade
  `;
}

// The osapiens-freshdesk connection seeded by schema.sql.
export async function seededFreshdeskConnId(): Promise<string> {
  const [row] = await sql`select id from source_connections where slug = 'osapiens-freshdesk'`;
  return row.id as string;
}

export async function tpdProductId(): Promise<string> {
  const [row] = await sql`select id from products where slug = 'tpd'`;
  return row.id as string;
}
