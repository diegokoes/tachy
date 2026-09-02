import { sql } from "../infra/db";
import { log } from "../infra/log";
import type { LibraryTarget } from "./revisions";

/**
 * Two reads by the same person inside this window count once. EntryDetail
 * re-loads the entry after every successful edit, so without a window an editor
 * inflates their own read count; and a refresh is the same visit either way.
 */
export const VIEW_DEDUPE_MINUTES = 30;

/**
 * Record one human read. The agent reads through MCP in its own subprocess and
 * never reaches the HTTP routes that call this, so no filtering is needed for
 * this to mean people rather than tool calls.
 *
 * `userId` may be null — a bearer-token or open-mode caller has no identity, and
 * the unique indexes are `nulls not distinct` so those still bucket by day
 * instead of inserting a row per hit.
 */
export async function recordView(
  target: LibraryTarget,
  userId: string | null,
): Promise<void> {
  const window = `${VIEW_DEDUPE_MINUTES} minutes`;
  const docId = target.docId ?? null;
  // The conflict target repeats the index predicate; Postgres will not infer a
  // partial unique index without it.
  if (target.entryId) {
    await sql`
      insert into library_views (knowledge_entry_id, user_id, day)
      values (${target.entryId}, ${userId}, current_date)
      on conflict (knowledge_entry_id, user_id, day)
        where knowledge_entry_id is not null
      do update set views = library_views.views + 1, last_viewed_at = now()
        where library_views.last_viewed_at < now() - ${window}::interval
    `;
    return;
  }
  await sql`
    insert into library_views (reference_doc_id, user_id, day)
    values (${docId}, ${userId}, current_date)
    on conflict (reference_doc_id, user_id, day)
      where reference_doc_id is not null
    do update set views = library_views.views + 1, last_viewed_at = now()
      where library_views.last_viewed_at < now() - ${window}::interval
  `;
}

/**
 * Fire and forget: a read must never wait on its own bookkeeping, and a failure
 * to count is not a failure to read.
 */
export function countView(target: LibraryTarget, userId: string | null): void {
  void recordView(target, userId).catch((e) =>
    log("warn", "library_view_failed", { error: String(e) }),
  );
}

export interface ViewStats {
  views: number;
  viewers: number;
  last_viewed_at: string | null;
}

export async function viewStats(target: LibraryTarget): Promise<ViewStats> {
  const [row] = target.entryId
    ? await sql`
        select coalesce(sum(views), 0)::int as views,
               count(distinct user_id)::int as viewers,
               max(last_viewed_at) as last_viewed_at
        from library_views where knowledge_entry_id = ${target.entryId}
      `
    : await sql`
        select coalesce(sum(views), 0)::int as views,
               count(distinct user_id)::int as viewers,
               max(last_viewed_at) as last_viewed_at
        from library_views where reference_doc_id = ${target.docId ?? null}
      `;
  return row as ViewStats;
}

export interface DailyViews {
  day: string;
  views: number;
}

/** The read curve for one item, oldest first — a sparkline's worth of rows. */
export async function viewHistory(
  target: LibraryTarget,
  days = 90,
): Promise<DailyViews[]> {
  const since = sql`current_date - ${days}::int`;
  return (
    target.entryId
      ? sql`
          select day::text, sum(views)::int as views from library_views
          where knowledge_entry_id = ${target.entryId} and day >= ${since}
          group by day order by day
        `
      : sql`
          select day::text, sum(views)::int as views from library_views
          where reference_doc_id = ${target.docId ?? null} and day >= ${since}
          group by day order by day
        `
  ) as Promise<DailyViews[]>;
}
