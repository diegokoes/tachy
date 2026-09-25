import { sql, jsonb } from "../infra/db";
import { NOTIFICATION_KINDS } from "@tachy/contract";
import type { NotificationKind, NotificationRow } from "@tachy/contract";

export { NOTIFICATION_KINDS };

export interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  title?: string | null;
  body?: string | null;
  ref?: Record<string, unknown>;
}

/** Drop one notification in a person's inbox. The delivery seam every feature
 *  that needs to reach a user through the app goes through. */
export async function notify(i: NotifyInput): Promise<NotificationRow> {
  const [row] = await sql<NotificationRow[]>`
    insert into notifications (user_id, kind, title, body_text, ref)
    values (${i.userId}, ${i.kind}, ${i.title ?? null}, ${i.body ?? null},
            ${jsonb(i.ref ?? {})})
    returning id, kind, title, body_text, ref, seen_at, read_at, created_at
  `;
  return row;
}

export async function listNotifications(
  userId: string,
): Promise<NotificationRow[]> {
  return sql<NotificationRow[]>`
    select id, kind, title, body_text, ref, seen_at, read_at, created_at
    from notifications
    where user_id = ${userId}
    order by created_at desc
    limit 100
  `;
}

export async function unreadCount(userId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from notifications
    where user_id = ${userId} and read_at is null
  `;
  return row?.n ?? 0;
}

/** Mark the badge-clearing timestamp; leaves read_at alone so an item still
 *  shows as unopened in the list. */
export async function markSeen(userId: string): Promise<void> {
  await sql`
    update notifications set seen_at = now()
    where user_id = ${userId} and seen_at is null
  `;
}

export async function markRead(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await sql`
    update notifications set read_at = now(), seen_at = coalesce(seen_at, now())
    where user_id = ${userId} and id = any(${ids}) and read_at is null
  `;
}
