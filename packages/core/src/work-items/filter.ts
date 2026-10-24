import { sql } from "../infra/db";
import { badInput } from "../infra/errors";
import { getCustomerIdBySlug } from "../catalog/customers";
import { getProductIdBySlug } from "../catalog/products";
import { getTeamIdBySlug } from "../catalog/teams";

/**
 * Which stored tickets a list shows or a cleanup takes. Every field narrows,
 * and none given reaches every ticket.
 */
export interface StoredItemFilter {
  /** A source connection's slug. */
  connection?: string;
  /** Statuses as the source spells them, matched without regard to case. */
  statuses?: string[];
  product?: string;
  team?: string;
  customer?: string;
  /** The requester as stored, matched whole and without regard to case. */
  requester?: string;
  /** ISO date: tickets the source last changed before it. */
  changedBefore?: string;
  /**
   * A cleanup's alone: also take tickets a knowledge entry was learned from.
   * They are left by default: deleting one leaves the entry without its way
   * back to the ticket.
   */
  includeLearnedFrom?: boolean;
}

/** The fields of a filter that narrow it. */
export const NARROWING: (keyof StoredItemFilter)[] = [
  "connection",
  "statuses",
  "product",
  "team",
  "customer",
  "requester",
  "changedBefore",
];

export interface ResolvedItemFilter {
  connectionId?: string;
  statuses?: string[];
  productId?: string;
  teamId?: string;
  customerId?: string;
  requester?: string;
  changedBefore?: Date;
}

/** Slugs to ids and the date to a date, refusing what names nothing. */
export async function resolveItemFilter(
  filter: StoredItemFilter,
): Promise<ResolvedItemFilter> {
  const resolved: ResolvedItemFilter = {};
  if (filter.connection) {
    const [connection] = await sql<{ id: string }[]>`
      select id from source_connections where slug = ${filter.connection}
    `;
    if (!connection) throw badInput(`unknown source '${filter.connection}'`);
    resolved.connectionId = connection.id;
  }
  if (filter.statuses?.length)
    resolved.statuses = filter.statuses.map((status) => status.toLowerCase());
  if (filter.product)
    resolved.productId = await getProductIdBySlug(filter.product);
  if (filter.team) resolved.teamId = await getTeamIdBySlug(filter.team);
  if (filter.customer)
    resolved.customerId = await getCustomerIdBySlug(filter.customer);
  if (filter.requester) resolved.requester = filter.requester.toLowerCase();
  if (filter.changedBefore) {
    const before = new Date(filter.changedBefore);
    if (Number.isNaN(before.getTime()))
      throw badInput(`'${filter.changedBefore}' is not a date`);
    resolved.changedBefore = before;
  }
  return resolved;
}

/** A ticket the source never dated counts from when it was stored. */
export const CHANGED_AT = sql`coalesce(wi.source_updated_at, wi.ingested_at)`;

/** The condition a filter puts on `work_items wi`. */
export function reaches(resolved: ResolvedItemFilter) {
  return sql`
    true
    ${resolved.connectionId ? sql`and wi.source_connection_id = ${resolved.connectionId}` : sql``}
    ${resolved.statuses ? sql`and lower(wi.status) = any(${resolved.statuses}::text[])` : sql``}
    ${resolved.productId ? sql`and wi.product_id = ${resolved.productId}` : sql``}
    ${resolved.teamId ? sql`and wi.team_id = ${resolved.teamId}` : sql``}
    ${resolved.customerId ? sql`and wi.customer_id = ${resolved.customerId}` : sql``}
    ${resolved.requester ? sql`and lower(wi.requester) = ${resolved.requester}` : sql``}
    ${resolved.changedBefore ? sql`and ${CHANGED_AT} < ${resolved.changedBefore}` : sql``}
  `;
}
