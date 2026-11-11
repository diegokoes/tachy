import type { EntryTicket } from "@tachy/contract";
import { sql } from "../infra/db";
import type { Db } from "../infra/db";
import { badInput, notFound } from "../infra/errors";

/** The tickets an entry draws on: the one it was written from first, then by when they were added. */
export async function listEntryTickets(
  entryId: string,
): Promise<EntryTicket[]> {
  return sql<EntryTicket[]>`
    select wi.id as work_item_id, wi.external_id, wi.external_url, wi.title,
           wi.status, drawn.is_source
    from (
      select e.work_item_id, true as is_source, e.created_at
      from knowledge_entries e
      where e.id = ${entryId} and e.work_item_id is not null
      union all
      select added.work_item_id, false, added.created_at
      from knowledge_entry_work_items added
      where added.knowledge_entry_id = ${entryId}
    ) drawn
    join work_items wi on wi.id = drawn.work_item_id
    order by drawn.is_source desc, drawn.created_at
  `;
}

export async function assertWorkItemExists(
  db: Db,
  workItemId: string,
): Promise<void> {
  const [ticket] = await db`select id from work_items where id = ${workItemId}`;
  if (!ticket) throw badInput(`work item '${workItemId}' not found`);
}

/**
 * Adds a ticket to an entry's tickets; one it already draws on is left as it
 * is. The caller has checked the ticket exists.
 */
export async function insertEntryTicket(
  db: Db,
  entryId: string,
  workItemId: string,
  addedBy: string | null,
): Promise<void> {
  await db`
    insert into knowledge_entry_work_items (knowledge_entry_id, work_item_id, added_by)
    select e.id, ${workItemId}, ${addedBy}
    from knowledge_entries e
    where e.id = ${entryId} and e.work_item_id is distinct from ${workItemId}
    on conflict do nothing
  `;
}

export async function addEntryTicket(
  entryId: string,
  workItemId: string,
  addedBy: string | null,
): Promise<void> {
  await assertWorkItemExists(sql, workItemId);
  await insertEntryTicket(sql, entryId, workItemId, addedBy);
}

/** Removes an added ticket. The ticket an entry was written from is not removable. */
export async function removeEntryTicket(
  entryId: string,
  workItemId: string,
): Promise<void> {
  const removed = await sql`
    delete from knowledge_entry_work_items
    where knowledge_entry_id = ${entryId} and work_item_id = ${workItemId}
    returning work_item_id
  `;
  if (!removed.length)
    throw notFound("that ticket is not one this entry had added");
}
