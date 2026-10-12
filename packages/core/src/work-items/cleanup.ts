import { sql, type Db } from "../infra/db";
import { badInput } from "../infra/errors";
import {
  CHANGED_AT,
  NARROWING,
  reaches,
  resolveItemFilter,
  type ResolvedItemFilter,
  type StoredItemFilter,
} from "./filter";

export type { StoredItemFilter } from "./filter";

export interface StoredItemSample {
  connection: string;
  external_id: string;
  title: string | null;
  status: string | null;
  changed_at: string | null;
}

export interface StoredItemPreview {
  /** Tickets the cleanup would delete. */
  matched: number;
  /** Their stored messages, which go with them. */
  messages: number;
  /** Tickets the filter reaches and the cleanup leaves, for the entries learned from them. */
  kept_learned_from: number;
  by_status: { status: string | null; n: number }[];
  /** The ten the source changed longest ago. */
  sample: StoredItemSample[];
}

/**
 * A filter as the audit trail keeps it. The requester is said to have been
 * given and is not written down: a cleanup made to remove a person would
 * otherwise leave their name in a trail nothing is deleted from.
 */
export function filterForAudit(
  filter: StoredItemFilter,
): Record<string, unknown> {
  const { requester, ...rest } = filter;
  return requester ? { ...rest, requester: "given" } : rest;
}

const SAMPLE_SIZE = 10;

type Resolved = ResolvedItemFilter;

/** The filter resolved. One that narrows nothing is a mistake and not everything. */
async function resolve(filter: StoredItemFilter): Promise<Resolved> {
  const given = NARROWING.filter((key) => {
    const value = filter[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
  if (!given.length)
    throw badInput(`a cleanup needs at least one of: ${NARROWING.join(", ")}`);
  return resolveItemFilter(filter);
}

const LEARNED_FROM = sql`
  exists (select 1 from knowledge_entries k where k.work_item_id = wi.id)
`;

/** The tickets a cleanup deletes: what the filter reaches, less the ones it leaves. */
function taken(resolved: Resolved, includeLearnedFrom: boolean) {
  return includeLearnedFrom
    ? reaches(resolved)
    : sql`${reaches(resolved)} and not ${LEARNED_FROM}`;
}

interface Counts {
  matched: number;
  messages: number;
  kept_learned_from: number;
}

async function countTaken(
  db: Db,
  resolved: Resolved,
  includeLearnedFrom: boolean,
): Promise<Counts> {
  const where = taken(resolved, includeLearnedFrom);
  const [counts] = await db<Counts[]>`
    select
      (select count(*)::int from work_items wi where ${where}) as matched,
      (select count(*)::int from work_item_messages m
         join work_items wi on wi.id = m.work_item_id where ${where}) as messages,
      (select count(*)::int from work_items wi
         where ${reaches(resolved)} and ${LEARNED_FROM}
           and not ${includeLearnedFrom}) as kept_learned_from
  `;
  return counts;
}

/** What a cleanup with this filter would delete, without deleting it. */
export async function previewStoredItems(
  filter: StoredItemFilter,
): Promise<StoredItemPreview> {
  const resolved = await resolve(filter);
  const includeLearnedFrom = Boolean(filter.includeLearnedFrom);
  const where = taken(resolved, includeLearnedFrom);

  const [counts, byStatus, sample] = await Promise.all([
    countTaken(sql, resolved, includeLearnedFrom),
    sql<{ status: string | null; n: number }[]>`
      select wi.status, count(*)::int as n from work_items wi
      where ${where} group by wi.status order by n desc, wi.status
    `,
    sql<StoredItemSample[]>`
      select sc.slug as connection, wi.external_id, wi.title, wi.status,
             ${CHANGED_AT} as changed_at
      from work_items wi
      join source_connections sc on sc.id = wi.source_connection_id
      where ${where}
      order by ${CHANGED_AT} asc, wi.external_id
      limit ${SAMPLE_SIZE}
    `,
  ]);
  return { ...counts, by_status: [...byStatus], sample: [...sample] };
}

export interface StoredItemCleanup {
  deleted: number;
  messages: number;
  kept_learned_from: number;
}

/**
 * Deletes the stored tickets the filter takes, with their messages and links.
 * `expected` is the count a preview gave: when it no longer holds, nothing is
 * deleted, so a cleanup never removes more than was looked at.
 */
export async function deleteStoredItems(
  filter: StoredItemFilter,
  expected: number,
): Promise<StoredItemCleanup> {
  const resolved = await resolve(filter);
  const includeLearnedFrom = Boolean(filter.includeLearnedFrom);

  return sql.begin(async (tx) => {
    const counts = await countTaken(tx, resolved, includeLearnedFrom);
    if (counts.matched !== expected)
      throw badInput(
        `the filter now takes ${counts.matched} tickets, not the ${expected} that were previewed; preview again`,
      );
    await tx`
      delete from work_items wi where ${taken(resolved, includeLearnedFrom)}
    `;
    return {
      deleted: counts.matched,
      messages: counts.messages,
      kept_learned_from: counts.kept_learned_from,
    };
  }) as Promise<StoredItemCleanup>;
}
