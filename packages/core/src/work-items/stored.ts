import {
  MAX_PAGE,
  type StoredItem,
  type StoredItemEntry,
  type StoredItemPage,
  type StoredItemRow,
} from "@tachy/contract";
import { sql } from "../infra/db";
import { notFound } from "../infra/errors";
import type { RawMessage, RawWorkItem } from "./raw";
import {
  CHANGED_AT,
  reaches,
  resolveItemFilter,
  type StoredItemFilter,
} from "./filter";

const COLUMNS = sql`
  wi.id, sc.slug as connection, sc.source_type, wi.external_id,
  wi.external_url as url, wi.kind, wi.title, wi.status,
  wi.external_group_key as "group", wi.assignee, wi.priority, wi.item_type,
  wi.requester, cu.slug as customer, p.slug as product, t.slug as team,
  sp.name as project, wi.source_created_at as created_at,
  wi.source_updated_at as updated_at, wi.fetched_at,
  (select count(*)::int from work_item_messages m where m.work_item_id = wi.id) as messages,
  (select count(*)::int from work_item_events e where e.work_item_id = wi.id) as events
`;

const JOINS = sql`
  from work_items wi
  join source_connections sc on sc.id = wi.source_connection_id
  left join customers cu on cu.id = wi.customer_id
  left join products p on p.id = wi.product_id
  left join teams t on t.id = wi.team_id
  left join source_projects sp on sp.id = wi.source_project_id
`;

const iso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : null;

function toRow(row: Record<string, unknown>): StoredItemRow {
  return {
    ...(row as unknown as StoredItemRow),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    fetched_at: iso(row.fetched_at),
  };
}

export interface StoredItemPaging {
  /** Words of the title, or the source's id for the item whole. */
  query?: string;
  /** At most MAX_PAGE, which is also the default. */
  limit?: number;
  offset?: number;
}

/** The stored items a filter reaches, the most recently changed first. */
export async function listStoredItems(
  filter: StoredItemFilter,
  paging: StoredItemPaging = {},
): Promise<StoredItemPage> {
  const resolved = await resolveItemFilter(filter);
  const query = paging.query?.trim();
  const where = sql`
    ${reaches(resolved)}
    ${query ? sql`and (wi.external_id = ${query} or wi.title ilike ${"%" + query + "%"})` : sql``}
  `;
  const limit = Math.min(Math.max(paging.limit ?? MAX_PAGE, 1), MAX_PAGE);
  const [[{ total }], rows] = await Promise.all([
    sql<{ total: number }[]>`
      select count(*)::int as total from work_items wi where ${where}
    `,
    sql`
      select ${COLUMNS} ${JOINS}
      where ${where}
      order by ${CHANGED_AT} desc, wi.id
      limit ${limit} offset ${Math.max(paging.offset ?? 0, 0)}
    `,
  ]);
  return { total, items: rows.map(toRow) };
}

/** Events sort ahead of a message of the same moment: a ticket is opened, then says something. */
function inOrder(a: StoredItemEntry, b: StoredItemEntry): number {
  const byTime = (a.at ?? "").localeCompare(b.at ?? "");
  if (byTime) return byTime;
  if (a.kind !== b.kind) return a.kind === "event" ? -1 : 1;
  return a.id.localeCompare(b.id);
}

/** One stored item with its timeline, messages and events together, oldest first. */
export async function readStoredItem(id: string): Promise<StoredItem> {
  const [row] = await sql`select ${COLUMNS} ${JOINS} where wi.id = ${id}`;
  if (!row) throw notFound(`work item ${id} not found`);

  const [messages, events, [record]] = await Promise.all([
    sql`
      select id, created_at, author, author_label, automated, visibility,
             direction, body_text, jsonb_array_length(attachments) as files
      from work_item_messages where work_item_id = ${id}
    `,
    sql`
      select id, occurred_at, actor, field, old_value, new_value, origin
      from work_item_events where work_item_id = ${id}
    `,
    sql`
      select r.name, r.record, r.fetched_at
      from work_items wi
      join source_customer_records r
        on r.source_connection_id = wi.source_connection_id
       and r.external_id = wi.external_customer_key
      where wi.id = ${id}
    `,
  ]);

  const timeline: StoredItemEntry[] = [
    ...messages.map((m): StoredItemEntry => ({
      kind: "message",
      id: m.id,
      at: iso(m.created_at),
      author: m.author,
      author_label: m.author_label,
      automated: m.automated,
      visibility: m.visibility,
      direction: m.direction,
      text: m.body_text ?? "",
      files: m.files,
    })),
    ...events.map((e): StoredItemEntry => ({
      kind: "event",
      id: e.id,
      at: (e.occurred_at as Date).toISOString(),
      actor: e.actor,
      field: e.field,
      old_value: e.old_value,
      new_value: e.new_value,
      origin: e.origin,
    })),
  ].sort(inOrder);

  return {
    item: toRow(row),
    timeline,
    customer_record: record
      ? {
          name: record.name,
          record: record.record,
          fetched_at: (record.fetched_at as Date).toISOString(),
        }
      : null,
  };
}

/**
 * The stored copy as its source handed it over; no source call. With
 * `connectionSlug`, an item of another connection is not found.
 */
export async function readStoredRaw(
  workItemId: string,
  connectionSlug?: string,
): Promise<RawWorkItem> {
  const [row] = await sql`
    select wi.external_id, wi.kind, wi.title, wi.status,
           wi.external_group_key, wi.requester, wi.raw
    from work_items wi
    join source_connections sc on sc.id = wi.source_connection_id
    where wi.id = ${workItemId}
      ${connectionSlug ? sql`and sc.slug = ${connectionSlug}` : sql``}
  `;
  if (!row) throw notFound(`work item ${workItemId} not found`);
  const messages = await sql`
    select external_id, author, author_label, automated, visibility,
           direction, body_text, created_at
    from work_item_messages where work_item_id = ${workItemId}
    order by created_at nulls first, id
  `;
  return {
    externalId: row.external_id,
    kind: row.kind,
    title: row.title ?? undefined,
    status: row.status ?? undefined,
    groupKey: row.external_group_key ?? undefined,
    requester: row.requester ?? undefined,
    raw: row.raw ?? {},
    messages: messages.map((message): RawMessage => ({
      externalId: message.external_id ?? undefined,
      author: message.author ?? undefined,
      authorLabel: message.author_label ?? undefined,
      automated: message.automated,
      visibility: message.visibility,
      direction: message.direction,
      bodyText: message.body_text ?? "",
      createdAt: (message.created_at as Date | null)?.toISOString(),
    })),
  };
}
