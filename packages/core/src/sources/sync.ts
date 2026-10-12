import { recordRun } from "../analytics/runs";
import { resolveCurrentUserId } from "../access/users";
import { itemTriggers } from "../flows/triggers";
import { sql } from "../infra/db";
import { badInput } from "../infra/errors";
import { ingestWorkItem } from "../work-items/ingest";
import { resolveSource } from "./registry";

/**
 * Enough pages for any real backlog. An adapter that keeps handing back the same
 * cursor would otherwise walk one page for as long as the process runs.
 */
const MAX_SYNC_PAGES = 10_000;

/** A start date as given, or nothing for an empty one. */
function startDate(isoDate: string | undefined): Date | undefined {
  if (!isoDate?.trim()) return undefined;
  const start = new Date(isoDate);
  if (Number.isNaN(start.getTime()))
    throw badInput(`'${isoDate}' is not a date`);
  return start;
}

export interface SyncOptions {
  /** Walk from this date, whatever was synced before. */
  since?: string;
  /**
   * How far back the copy has to reach. Walked from once: after a clean walk
   * that started there or earlier, a run resumes from the last one.
   */
  from?: string;
  group?: string;
  signal?: AbortSignal;
  onPage?: (total: number, resumedFrom: string | undefined) => void;
}

/** Pulls a connection's changed work items, resuming from its last clean walk. */
export async function syncSource(
  sourceSlug: string,
  opts: SyncOptions = {},
): Promise<{ total: number; since: string | undefined }> {
  const { conn, source } = await resolveSource(sourceSlug);
  const [row] = await sql`
    select last_synced_at, listed_since from source_connections where id = ${conn.id}
  `;
  const reach = startDate(opts.from);
  const listedSince = row?.listed_since
    ? new Date(row.listed_since as string)
    : undefined;
  const reachOwed = reach && (!listedSince || reach < listedSince);
  // A date given for this walk wins, then a reach not yet walked; otherwise
  // pick up where the last good run stopped.
  const walkedFrom = startDate(opts.since) ?? (reachOwed ? reach : undefined);
  const since =
    walkedFrom?.toISOString() ??
    (row?.last_synced_at
      ? new Date(row.last_synced_at as string).toISOString()
      : undefined);

  // Taken before the walk, not after: anything changed while it runs must be
  // picked up next time rather than stepped over.
  const startedAt = new Date();

  const fire = await itemTriggers(sourceSlug);
  let cursor: string | undefined;
  let total = 0;
  const seen = new Set<string>();
  for (let page = 0; ; page++) {
    opts.signal?.throwIfAborted();
    if (page >= MAX_SYNC_PAGES)
      throw new Error(
        `${sourceSlug} did not finish within ${MAX_SYNC_PAGES} pages; stopped`,
      );
    const { items, nextCursor } = await source.listItems({
      updatedSince: since,
      groupKey: opts.group,
      cursor,
    });
    for (const item of items) {
      const stored = await ingestWorkItem(conn.id, item);
      if (fire && stored.changed)
        await fire(stored.id, stored.inserted ? "created" : "updated");
      total++;
    }
    opts.onPage?.(total, since);
    if (!nextCursor) break;
    if (seen.has(nextCursor))
      throw new Error(
        `${sourceSlug} returned the cursor '${nextCursor}' twice; stopped`,
      );
    seen.add(nextCursor);
    cursor = nextCursor;
  }

  // Only on a clean walk. A run that threw has committed part of its items, and
  // moving the watermark would step over the rest on the next attempt.
  if (!opts.group)
    await sql`
      update source_connections set
        last_synced_at = ${startedAt},
        listed_since = least(listed_since, ${walkedFrom ?? null}::timestamptz)
      where id = ${conn.id}
    `;

  await recordRun({
    userId: await resolveCurrentUserId(),
    mode: "sync",
    meta: { source: sourceSlug, total },
  });
  return { total, since };
}
