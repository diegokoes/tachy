import { sql, toDate } from "../infra/db";
import type { RawWorkItem } from "../sources/source";
import { resolveCustomerByEmail } from "../catalog/customers";
import { routeIngest } from "../sources/projects";

export interface IngestedItem {
  id: string;
  sourceProjectId: string | null;
  productId: string | null;
  teamId: string | null;
  customerId: string | null;
  /** Set when the sender's domain matched several customers and so decided none. */
  customerAmbiguity?: string;
  observedVersion: string | null;
  /** Component the item's area path maps to, when the project has a rule for it. */
  componentSlug: string | null;
}

export async function ingestWorkItem(
  connId: string,
  raw: RawWorkItem,
): Promise<IngestedItem> {
  const route = await routeIngest(connId, raw.groupKey, raw.areaPath);
  const { sourceProjectId, productId, teamId } = route;

  /*
   * A project that exists for one customer settles the question by configuration,
   * and beats the sender's domain — which partners, freemail and internally-filed
   * tickets all defeat. A disagreement is reported rather than swallowed: it means
   * either the project is not really single-customer, or the domain belongs on a
   * different customer's row, and both are worth someone's attention.
   */
  const match = await resolveCustomerByEmail(raw.requesterEmail);
  const customerId = route.customerId ?? match.customerId;
  const conflict =
    route.customerId &&
    match.customerId &&
    route.customerId !== match.customerId
      ? "the sender's email domain points at a different customer than the project this came from — the project won; check which is wrong"
      : undefined;

  return sql.begin(async (tx) => {
    const [item] = await tx`
      insert into work_items
        (source_connection_id, external_id, external_url, kind, title, status,
         external_group_key, source_project_id, product_id, team_id, customer_id, requester, raw,
         source_created_at, source_updated_at)
      values
        (${connId}, ${raw.externalId}, ${raw.externalUrl ?? null}, ${raw.kind}, ${raw.title ?? null},
         ${raw.status ?? null}, ${raw.groupKey ?? null}, ${sourceProjectId}, ${productId}, ${teamId}, ${customerId}, ${raw.requester ?? null},
         ${sql.json((raw.raw ?? {}) as any)}, ${toDate(raw.sourceCreatedAt)}, ${toDate(raw.sourceUpdatedAt)})
      on conflict (source_connection_id, external_id) do update set
        title = excluded.title,
        status = excluded.status,
        external_url = excluded.external_url,
        raw = excluded.raw,
        source_updated_at = excluded.source_updated_at,
        source_project_id = excluded.source_project_id,
        product_id = excluded.product_id,
        team_id = excluded.team_id
      returning id, source_project_id, product_id, team_id, customer_id, observed_version
    `;

    if (raw.messages.length) {
      const m = raw.messages;
      await tx`
        insert into work_item_messages
          (work_item_id, external_id, author, visibility, direction, body_text, attachments, created_at)
        select ${item.id}, u.external_id, u.author, u.visibility, u.direction,
               u.body_text, u.attachments::jsonb, u.created_at::timestamptz
        from unnest(
          ${m.map((x) => x.externalId ?? null)}::text[],
          ${m.map((x) => x.author ?? null)}::text[],
          ${m.map((x) => x.visibility)}::text[],
          ${m.map((x) => x.direction)}::text[],
          ${m.map((x) => x.bodyText)}::text[],
          ${m.map((x) => JSON.stringify(x.attachments ?? []))}::text[],
          ${m.map((x) => {
            const d = toDate(x.createdAt);
            return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
          })}::text[]
        ) as u(external_id, author, visibility, direction, body_text, attachments, created_at)
        on conflict (work_item_id, external_id) do update set
          author = excluded.author,
          body_text = excluded.body_text,
          attachments = excluded.attachments,
          created_at = excluded.created_at
      `;
    }

    return {
      id: item.id,
      sourceProjectId: item.source_project_id,
      productId: item.product_id,
      teamId: item.team_id,
      customerId: item.customer_id,
      ...(conflict
        ? { customerAmbiguity: conflict }
        : match.reason && !route.customerId
          ? { customerAmbiguity: match.reason }
          : {}),
      observedVersion: item.observed_version,
      componentSlug: route.componentSlug,
    };
  });
}
