import { sql } from "../infra/db";
import type { EntryScope } from "../access/permissions";

/**
 * The product and team a work item belongs to, which is what decides who may
 * edit what hangs off it. An unknown id yields an empty scope rather than
 * throwing: "no scope" is what the permission check is built to refuse, and a
 * caller that cannot see the row should not learn whether it exists.
 */
export async function workItemScope(id: string): Promise<EntryScope> {
  const [row] =
    await sql`select product_id, team_id from work_items where id = ${id}`;
  return row ? { productId: row.product_id, teamId: row.team_id } : {};
}

export async function externalWorkItemScope(
  connId: string,
  externalId: string,
): Promise<EntryScope> {
  const [row] = await sql`
    select product_id, team_id from work_items
    where source_connection_id = ${connId} and external_id = ${externalId}
  `;
  return row ? { productId: row.product_id, teamId: row.team_id } : {};
}
