import { recordRun } from "../analytics/runs";
import { resolveCurrentUserId } from "../access/users";
import { sql } from "../infra/db";
import { ingestWorkItem } from "../work-items/ingest";
import { resolveSource } from "./registry";

/**
 * Enough pages for any real backlog. An adapter that keeps handing back the same
 * cursor would otherwise walk one page for as long as the process runs.
 */
const MAX_SYNC_PAGES = 10_000;

/** Pulls a connection's changed work items, resuming from its last clean walk. */
export async function syncSource(
  sourceSlug: string,
  opts: {
    since?: string;
    group?: string;
    signal?: AbortSignal;
    onPage?: (total: number, resumedFrom: string | undefined) => void;
  } = {},
): Promise<{ total: number; since: string | undefined }> {
  const { conn, source } = await resolveSource(sourceSlug);
  // An explicit since wins; otherwise pick up where the last good run stopped.
  const [row] =
    await sql`select last_synced_at from source_connections where id = ${conn.id}`;
  const since =
    opts.since ??
    (row?.last_synced_at
      ? new Date(row.last_synced_at as string).toISOString()
      : undefined);

  // Taken before the walk, not after: anything changed while it runs must be
  // picked up next time rather than stepped over.
  const startedAt = new Date();

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
    for (const it of items) {
      await ingestWorkItem(conn.id, it);
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
      update source_connections set last_synced_at = ${startedAt} where id = ${conn.id}
    `;

  await recordRun({
    userId: await resolveCurrentUserId(),
    mode: "sync",
    meta: { source: sourceSlug, total },
  });
  return { total, since };
}
