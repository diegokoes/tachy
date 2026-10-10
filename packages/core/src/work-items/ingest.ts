import { createHash } from "node:crypto";
import { sql, toDate, jsonb } from "../infra/db";
import type { RawMessage, RawWorkItem } from "../sources/source";
import { resolveCustomerByEmail } from "../catalog/customers";
import { routeIngest } from "../sources/projects";

export interface IngestedItem {
  id: string;
  sourceProjectId: string | null;
  productId: string | null;
  teamId: string | null;
  customerId: string | null;
  /** Which part of their estate, when someone has said. Never inferred here. */
  customerUnitId: string | null;
  /** Set when the sender's domain matched several customers and so decided none. */
  customerAmbiguity?: string;
  observedVersion: string | null;
  /** Component the item's area path maps to, when the project has a rule for it. */
  componentSlug: string | null;
  /** No row existed for it before this call. */
  inserted: boolean;
  /** New, or the source's updated time moved: something happened to it. */
  changed: boolean;
}

/**
 * What a message is stored under: the source's own id, or one made from the
 * message where the source gives none. A stored id of null matches nothing, so
 * without this each fetch of the ticket would add the message again.
 */
export function messageKey(message: RawMessage): string {
  if (message.externalId) return message.externalId;
  const digest = createHash("sha256")
    .update(
      [message.author ?? "", message.createdAt ?? "", message.bodyText].join(
        "\u0000",
      ),
    )
    .digest("hex");
  return `h-${digest.slice(0, 32)}`;
}

export async function ingestWorkItem(
  connId: string,
  raw: RawWorkItem,
): Promise<IngestedItem> {
  const route = await routeIngest(connId, raw.groupKey, raw.areaPath);
  const { sourceProjectId, productId, teamId } = route;

  // A single-customer project settles it by configuration and beats the
  // sender's domain, which partners and freemail defeat. A disagreement is
  // reported: one of the two is filed wrong.
  const match = await resolveCustomerByEmail(raw.requesterEmail);
  const customerId = route.customerId ?? match.customerId;
  const conflict =
    route.customerId &&
    match.customerId &&
    route.customerId !== match.customerId
      ? "sender domain and project map to different customers; project won, check which is wrong"
      : undefined;

  return sql.begin(async (tx) => {
    const [item] = await tx`
      with prior as (
        select source_updated_at from work_items
        where source_connection_id = ${connId} and external_id = ${raw.externalId}
      )
      insert into work_items
        (source_connection_id, external_id, external_url, kind, title, status,
         external_group_key, source_project_id, product_id, team_id, customer_id, requester, raw,
         source_created_at, source_updated_at)
      values
        (${connId}, ${raw.externalId}, ${raw.externalUrl ?? null}, ${raw.kind}, ${raw.title ?? null},
         ${raw.status ?? null}, ${raw.groupKey ?? null}, ${sourceProjectId}, ${productId}, ${teamId}, ${customerId}, ${raw.requester ?? null},
         ${jsonb(raw.raw ?? {})}, ${toDate(raw.sourceCreatedAt)}, ${toDate(raw.sourceUpdatedAt)})
      on conflict (source_connection_id, external_id) do update set
        title = excluded.title,
        status = excluded.status,
        external_url = excluded.external_url,
        raw = excluded.raw,
        source_updated_at = excluded.source_updated_at,
        source_project_id = excluded.source_project_id,
        product_id = excluded.product_id,
        team_id = excluded.team_id,
        -- Filled in, never overwritten: a manual set_work_item_customer has to
        -- survive a re-fetch, but a ticket ingested before its customer existed
        -- would otherwise stay unattributed forever, even after add_customer.
        customer_id = coalesce(work_items.customer_id, excluded.customer_id)
      returning id, source_project_id, product_id, team_id, customer_id,
                customer_unit_id, observed_version, (xmax = 0) as inserted,
                source_updated_at is distinct from (select source_updated_at from prior) as moved
    `;

    if (raw.messages.length) {
      // One row per key: the same key twice in one statement is an error.
      const keyed = new Map(raw.messages.map((x) => [messageKey(x), x]));
      const keys = [...keyed.keys()];
      const messages = [...keyed.values()];
      await tx`
        insert into work_item_messages
          (work_item_id, external_id, author, visibility, direction, body_text, attachments, created_at)
        select ${item.id}, u.external_id, u.author, u.visibility, u.direction,
               u.body_text, u.attachments::jsonb, u.created_at::timestamptz
        from unnest(
          ${keys}::text[],
          ${messages.map((x) => x.author ?? null)}::text[],
          ${messages.map((x) => x.visibility)}::text[],
          ${messages.map((x) => x.direction)}::text[],
          ${messages.map((x) => x.bodyText)}::text[],
          ${messages.map((x) => JSON.stringify(x.attachments ?? []))}::text[],
          ${messages.map((x) => {
            const created = toDate(x.createdAt);
            return created && !Number.isNaN(created.getTime())
              ? created.toISOString()
              : null;
          })}::text[]
        ) as u(external_id, author, visibility, direction, body_text, attachments, created_at)
        on conflict (work_item_id, external_id) do update set
          author = excluded.author,
          body_text = excluded.body_text,
          attachments = excluded.attachments,
          created_at = excluded.created_at
      `;
      // A fetch that carries messages carries all of them, so what the stored
      // copy holds beyond those was deleted at the source. A sync carries
      // none, and leaves the stored ones alone.
      await tx`
        delete from work_item_messages
        where work_item_id = ${item.id}
          and (external_id is null or external_id <> all(${keys}::text[]))
      `;
    }

    // Only when routing decided the stored value. The upsert leaves an
    // existing attribution alone, so on a re-fetch the stored customer_id
    // did not come from this routing and there is no conflict to report.
    const routed = item.customer_id === customerId;
    const unsettled = route.customerId ? undefined : match.reason;
    const customerAmbiguity = routed ? (conflict ?? unsettled) : undefined;

    return {
      id: item.id,
      sourceProjectId: item.source_project_id,
      productId: item.product_id,
      teamId: item.team_id,
      customerId: item.customer_id,
      customerUnitId: item.customer_unit_id ?? null,
      ...(customerAmbiguity ? { customerAmbiguity } : {}),
      observedVersion: item.observed_version,
      componentSlug: route.componentSlug,
      inserted: item.inserted,
      changed: item.inserted || item.moved,
    };
  });
}
