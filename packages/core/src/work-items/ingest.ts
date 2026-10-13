import { createHash } from "node:crypto";
import { sql, toDate, jsonb, type Db } from "../infra/db";
import type { RawEvent, RawMessage, RawWorkItem } from "../sources/source";
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

/** The fields whose change between two reads is recorded, as an event names them. */
interface Watched {
  status: string | null;
  group: string | null;
  assignee: string | null;
  priority: string | null;
  type: string | null;
}

/**
 * What differs between the stored item and the one just read, as events at
 * the time the source says it last changed. Nothing without that time.
 */
function observedChanges(prior: Watched, raw: RawWorkItem): RawEvent[] {
  const changedAt = toDate(raw.sourceUpdatedAt);
  if (!changedAt || Number.isNaN(changedAt.getTime())) return [];
  const occurredAt = changedAt.toISOString();
  const read: Watched = {
    status: raw.status ?? null,
    group: raw.groupKey ?? null,
    assignee: raw.assignee ?? null,
    priority: raw.priority ?? null,
    type: raw.itemType ?? null,
  };
  return (Object.keys(read) as (keyof Watched)[])
    .filter((field) => read[field] !== prior[field])
    .map((field) => ({
      externalId: `observed:${field}:${occurredAt}`,
      occurredAt,
      field,
      oldValue: prior[field],
      newValue: read[field],
    }));
}

async function storeEvents(
  tx: Db,
  workItemId: string,
  events: RawEvent[],
  origin: "source" | "observed",
): Promise<void> {
  // One row per key, and none for an event the source did not date.
  const keyed = new Map<string, RawEvent & { at: string }>();
  for (const event of events) {
    const occurred = toDate(event.occurredAt);
    if (!occurred || Number.isNaN(occurred.getTime())) continue;
    keyed.set(event.externalId, { ...event, at: occurred.toISOString() });
  }
  if (!keyed.size) return;
  const rows = [...keyed.values()];
  await tx`
    insert into work_item_events
      (work_item_id, external_id, occurred_at, actor, field, old_value, new_value, origin)
    select ${workItemId}, u.external_id, u.occurred_at::timestamptz, u.actor, u.field,
           u.old_value, u.new_value, ${origin}
    from unnest(
      ${rows.map((x) => x.externalId)}::text[],
      ${rows.map((x) => x.at)}::text[],
      ${rows.map((x) => x.actor ?? null)}::text[],
      ${rows.map((x) => x.field)}::text[],
      ${rows.map((x) => x.oldValue ?? null)}::text[],
      ${rows.map((x) => x.newValue ?? null)}::text[]
    ) as u(external_id, occurred_at, actor, field, old_value, new_value)
    on conflict (work_item_id, external_id) do update set
      occurred_at = excluded.occurred_at,
      actor = excluded.actor,
      field = excluded.field,
      old_value = excluded.old_value,
      new_value = excluded.new_value,
      origin = excluded.origin
  `;
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

  const listed = raw.listed === true;
  const fetchedAt = listed ? null : new Date();

  return sql.begin(async (tx) => {
    const [item] = await tx`
      with prior as (
        select source_updated_at, status, external_group_key as "group", assignee,
               priority, item_type as type
        from work_items
        where source_connection_id = ${connId} and external_id = ${raw.externalId}
      )
      insert into work_items
        (source_connection_id, external_id, external_url, kind, title, status,
         external_group_key, source_project_id, product_id, team_id, customer_id, requester,
         assignee, priority, item_type, external_customer_key, raw,
         source_created_at, source_updated_at, fetched_at)
      values
        (${connId}, ${raw.externalId}, ${raw.externalUrl ?? null}, ${raw.kind}, ${raw.title ?? null},
         ${raw.status ?? null}, ${raw.groupKey ?? null}, ${sourceProjectId}, ${productId}, ${teamId}, ${customerId}, ${raw.requester ?? null},
         ${raw.assignee ?? null}, ${raw.priority ?? null}, ${raw.itemType ?? null},
         ${raw.customerKey ?? null}, ${jsonb(raw.raw ?? {})},
         ${toDate(raw.sourceCreatedAt)}, ${toDate(raw.sourceUpdatedAt)}, ${fetchedAt})
      on conflict (source_connection_id, external_id) do update set
        kind = excluded.kind,
        title = excluded.title,
        status = excluded.status,
        external_url = excluded.external_url,
        external_group_key = excluded.external_group_key,
        requester = excluded.requester,
        assignee = excluded.assignee,
        priority = excluded.priority,
        item_type = excluded.item_type,
        external_customer_key = excluded.external_customer_key,
        -- A listing lays its fields over the stored payload: what only a fetch
        -- returns (a description, resolved relations) stays from the last one.
        raw = case when ${listed} then coalesce(work_items.raw, '{}'::jsonb) || excluded.raw
                   else excluded.raw end,
        source_created_at = coalesce(excluded.source_created_at, work_items.source_created_at),
        source_updated_at = excluded.source_updated_at,
        fetched_at = coalesce(excluded.fetched_at, work_items.fetched_at),
        source_project_id = excluded.source_project_id,
        product_id = excluded.product_id,
        team_id = excluded.team_id,
        -- Filled in, never overwritten: a manual set_work_item_customer has to
        -- survive a re-fetch, but a ticket ingested before its customer existed
        -- would otherwise stay unattributed forever, even after add_customer.
        customer_id = coalesce(work_items.customer_id, excluded.customer_id)
      returning id, source_project_id, product_id, team_id, customer_id,
                customer_unit_id, observed_version, (xmax = 0) as inserted,
                source_updated_at is distinct from (select source_updated_at from prior) as moved,
                (select to_jsonb(prior) from prior) as prior
    `;

    if (raw.customerKey && raw.customerRecord)
      await tx`
        insert into source_customer_records
          (source_connection_id, external_id, name, record)
        values
          (${connId}, ${raw.customerKey}, ${raw.customerRecord.name ?? null},
           ${jsonb(raw.customerRecord.record)})
        on conflict (source_connection_id, external_id) do update set
          name = excluded.name,
          record = excluded.record,
          fetched_at = now()
      `;

    await storeEvents(tx, item.id, raw.events ?? [], "source");
    // The source's own history says more than two reads differing can, and
    // says it once.
    if (raw.historyComplete)
      await tx`
        delete from work_item_events
        where work_item_id = ${item.id} and origin = 'observed'
      `;
    // A value that differs while the source says nothing changed was read
    // differently, not changed.
    else if (item.prior && item.moved)
      await storeEvents(
        tx,
        item.id,
        observedChanges(item.prior as Watched, raw),
        "observed",
      );

    // One row per key: the same key twice in one statement is an error.
    const keyed = new Map(raw.messages.map((x) => [messageKey(x), x]));
    const keys = [...keyed.keys()];
    const messages = [...keyed.values()];
    if (messages.length)
      await tx`
        insert into work_item_messages
          (work_item_id, external_id, author, author_label, automated, visibility, direction,
           body_text, attachments, created_at)
        select ${item.id}, u.external_id, u.author, u.author_label, u.automated::boolean,
               u.visibility, u.direction, u.body_text, u.attachments::jsonb,
               u.created_at::timestamptz
        from unnest(
          ${keys}::text[],
          ${messages.map((x) => x.author ?? null)}::text[],
          ${messages.map((x) => x.authorLabel ?? null)}::text[],
          ${messages.map((x) => String(x.automated === true))}::text[],
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
        ) as u(external_id, author, author_label, automated, visibility, direction,
               body_text, attachments, created_at)
        on conflict (work_item_id, external_id) do update set
          author = excluded.author,
          author_label = excluded.author_label,
          automated = excluded.automated,
          visibility = excluded.visibility,
          direction = excluded.direction,
          body_text = excluded.body_text,
          attachments = excluded.attachments,
          created_at = excluded.created_at
      `;
    // A fetch carries every message, so what the stored copy holds beyond
    // those was deleted at the source. A listing read none, and leaves the
    // stored ones alone.
    if (!listed)
      await tx`
        delete from work_item_messages
        where work_item_id = ${item.id}
          and (external_id is null or external_id <> all(${keys}::text[]))
      `;

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
