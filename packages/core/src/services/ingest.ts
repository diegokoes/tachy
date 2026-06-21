import { sql, toDate } from "../db";
import type { RawWorkItem } from "../source";
import { resolveCustomerByEmail } from "./customers";

export interface IngestedItem {
  id: string;
  productId: string | null;
  teamId: string | null;
  customerId: string | null;
  observedVersion: string | null;
}

export async function ingestWorkItem(connId: string, raw: RawWorkItem): Promise<IngestedItem> {
  let productId: string | null = null;
  let teamId: string | null = null;

  if (raw.groupKey) {
    const [map] = await sql`
      select product_id from source_product_map
      where source_connection_id = ${connId} and external_group_key = ${raw.groupKey}
    `;
    if (map) {
      productId = map.product_id;
      const [prod] = await sql`select team_id from products where id = ${productId}`;
      teamId = prod?.team_id ?? null;
    }
  }

  const customerId = await resolveCustomerByEmail(raw.requesterEmail);

  // customer_id omitted from ON CONFLICT SET — resolved on first insert only, never overwritten by re-sync.
  const [item] = await sql`
    insert into work_items
      (source_connection_id, external_id, external_url, kind, title, status,
       external_group_key, product_id, team_id, customer_id, requester, raw,
       source_created_at, source_updated_at)
    values
      (${connId}, ${raw.externalId}, ${raw.externalUrl ?? null}, ${raw.kind}, ${raw.title ?? null},
       ${raw.status ?? null}, ${raw.groupKey ?? null}, ${productId}, ${teamId}, ${customerId}, ${raw.requester ?? null},
       ${sql.json((raw.raw ?? {}) as any)}, ${toDate(raw.sourceCreatedAt)}, ${toDate(raw.sourceUpdatedAt)})
    on conflict (source_connection_id, external_id) do update set
      title = excluded.title,
      status = excluded.status,
      raw = excluded.raw,
      source_updated_at = excluded.source_updated_at,
      product_id = excluded.product_id,
      team_id = excluded.team_id
    returning id, product_id, team_id, customer_id, observed_version
  `;

  for (const m of raw.messages) {
    await sql`
      insert into work_item_messages
        (work_item_id, external_id, author, visibility, direction, body_text, attachments, created_at)
      values
        (${item.id}, ${m.externalId ?? null}, ${m.author ?? null}, ${m.visibility}, ${m.direction},
         ${m.bodyText}, ${sql.json((m.attachments ?? []) as any)}, ${toDate(m.createdAt)})
      on conflict (work_item_id, external_id) do nothing
    `;
  }

  return {
    id: item.id, productId: item.product_id, teamId: item.team_id,
    customerId: item.customer_id, observedVersion: item.observed_version,
  };
}
