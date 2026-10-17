/**
 * Items a person follows on the board. A scheduled check reads each one's
 * revision with the follower's own token and leaves one unread note per item
 * when someone else changed it; a follower with no saved token is skipped.
 */
import { sql } from "../infra/db";
import { errorText } from "../infra/known-secrets";
import { log } from "../infra/log";
import { notify } from "../notifications/notifications";
import { resolvePersonalSource } from "../sources/registry";
import type { FollowedChange } from "../sources/source";

/** Lines one change note keeps, newest first. */
const MAX_NOTE_LINES = 8;

export interface FollowRow {
  connection: string;
  external_id: string;
  source_project_id: string | null;
  seen_rev: number | null;
  created_at: string;
}

export interface FollowInput {
  userId: string;
  connectionId: string;
  externalId: string;
  sourceProjectId?: string | null;
  /** The revision the follower has seen; null lets the next check set it. */
  seenRev?: number | null;
  /** A ticket that gets a private note each time the item changes. */
  noteTo?: string;
}

export async function followWorkItem(input: FollowInput): Promise<void> {
  await sql`
    insert into work_item_follows
      (user_id, source_connection_id, external_id, source_project_id, seen_rev)
    values (${input.userId}, ${input.connectionId}, ${input.externalId},
            ${input.sourceProjectId ?? null}, ${input.seenRev ?? null})
    on conflict (user_id, source_connection_id, external_id) do update
      set source_project_id = coalesce(excluded.source_project_id,
                                       work_item_follows.source_project_id)
  `;
  if (!input.noteTo) return;
  await sql`
    insert into work_item_follow_notes
      (user_id, source_connection_id, external_id, work_item_id)
    values (${input.userId}, ${input.connectionId}, ${input.externalId}, ${input.noteTo})
    on conflict do nothing
  `;
}

export async function unfollowWorkItem(
  userId: string,
  connectionId: string,
  externalId: string,
): Promise<void> {
  await sql`
    delete from work_item_follows
    where user_id = ${userId} and source_connection_id = ${connectionId}
      and external_id = ${externalId}
  `;
}

/** `connectionId` narrows to one connection. */
export async function listFollows(
  userId: string,
  connectionId?: string,
): Promise<FollowRow[]> {
  return sql<FollowRow[]>`
    select c.slug as connection, f.external_id, f.source_project_id,
           f.seen_rev, f.created_at
    from work_item_follows f
    join source_connections c on c.id = f.source_connection_id
    where f.user_id = ${userId}
      ${connectionId ? sql`and f.source_connection_id = ${connectionId}` : sql``}
    order by f.created_at desc
  `;
}

export async function isFollowing(
  userId: string,
  connectionId: string,
  externalId: string,
): Promise<boolean> {
  const [row] = await sql`
    select 1 from work_item_follows
    where user_id = ${userId} and source_connection_id = ${connectionId}
      and external_id = ${externalId}
  `;
  return Boolean(row);
}

/** Opening an item is reading what changed on it. */
export async function markItemNotesRead(
  userId: string,
  connectionId: string,
  externalId: string,
): Promise<void> {
  await sql`
    update notifications set read_at = now(), seen_at = coalesce(seen_at, now())
    where user_id = ${userId} and kind = 'work_item_changed' and read_at is null
      and ref->>'connection_id' = ${connectionId}
      and ref->>'external_id' = ${externalId}
  `;
}

interface FollowTarget {
  connectionId: string;
  connection: string;
  sourceType: string;
  sourceProjectId: string | null;
}

/** A note per item: a newer change joins the unread one instead of stacking. */
async function noteChange(
  userId: string,
  target: FollowTarget,
  change: FollowedChange,
): Promise<void> {
  const title = `#${change.id} ${change.title}`;
  const [unread] = await sql<{ id: string; body_text: string | null }[]>`
    select id, body_text from notifications
    where user_id = ${userId} and kind = 'work_item_changed' and read_at is null
      and ref->>'connection_id' = ${target.connectionId}
      and ref->>'external_id' = ${change.id}
    order by created_at desc limit 1
  `;
  const earlier = unread?.body_text ? unread.body_text.split("\n") : [];
  const body = [...change.lines, ...earlier]
    .slice(0, MAX_NOTE_LINES)
    .join("\n");
  if (unread) {
    await sql`
      update notifications
      set title = ${title}, body_text = ${body}, created_at = now(), seen_at = null
      where id = ${unread.id}
    `;
    return;
  }
  await notify({
    userId,
    kind: "work_item_changed",
    title,
    body,
    ref: {
      source_type: target.sourceType,
      connection: target.connection,
      connection_id: target.connectionId,
      source_project_id: target.sourceProjectId,
      external_id: change.id,
      url: change.url,
    },
  });
}

export interface FollowCheck {
  people: number;
  checked: number;
  changed: number;
  /** Follows not read: no token of the follower's own, or the source refused. */
  skipped: number;
  /** Private notes posted on tickets that follow wrote back to. */
  notes: number;
  /** Notes not posted: no token of the follower's own, or the source refused. */
  notes_skipped: number;
}

interface FollowedRow {
  user_id: string;
  connection_id: string;
  connection: string;
  source_type: string;
  external_id: string;
  source_project_id: string | null;
  seen_rev: number | null;
}

export async function checkFollows(): Promise<FollowCheck> {
  const rows = await sql<FollowedRow[]>`
    select f.user_id, f.source_connection_id as connection_id,
           c.slug as connection, c.source_type, f.external_id,
           f.source_project_id, f.seen_rev
    from work_item_follows f
    join source_connections c on c.id = f.source_connection_id
    order by f.user_id, c.slug
  `;
  const groups = new Map<string, FollowedRow[]>();
  for (const row of rows) {
    const key = `${row.user_id}|${row.connection_id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const outcome: FollowCheck = {
    people: new Set(rows.map((row) => row.user_id)).size,
    checked: 0,
    changed: 0,
    skipped: 0,
    notes: 0,
    notes_skipped: 0,
  };
  for (const follows of groups.values()) {
    const [first] = follows;
    const resolved = await resolvePersonalSource(
      first.connection,
      first.user_id,
    );
    const browser = resolved?.source.browser;
    if (!browser) {
      outcome.skipped += follows.length;
      continue;
    }
    let changes: FollowedChange[];
    try {
      changes = await browser.changes(
        follows.map((row) => ({ id: row.external_id, seenRev: row.seen_rev })),
      );
    } catch (e) {
      log("warn", "follows_check_failed", {
        connection: first.connection,
        error: errorText(e),
      });
      outcome.skipped += follows.length;
      continue;
    }
    const projectOf = new Map(
      follows.map((row) => [row.external_id, row.source_project_id]),
    );
    for (const change of changes) {
      outcome.checked++;
      await sql`
        update work_item_follows set seen_rev = ${change.rev}, checked_at = now()
        where user_id = ${first.user_id}
          and source_connection_id = ${first.connection_id}
          and external_id = ${change.id}
      `;
      if (!change.lines.length) continue;
      outcome.changed++;
      await noteChange(
        first.user_id,
        {
          connectionId: first.connection_id,
          connection: first.connection,
          sourceType: first.source_type,
          sourceProjectId: projectOf.get(change.id) ?? null,
        },
        change,
      );
      await noteBack(first.user_id, first.connection_id, change, outcome);
    }
  }
  return outcome;
}

/** The note a ticket gets when an item it follows changes. */
function changeNote(change: FollowedChange): string {
  return [
    `#${change.id} ${change.title} changed:`,
    ...change.lines.map((line) => `- ${line}`),
    change.url,
  ].join("\n");
}

/**
 * Each ticket the follow writes back to gets the change as a private note,
 * posted with the follower's own token on the ticket's connection.
 */
async function noteBack(
  userId: string,
  connectionId: string,
  change: FollowedChange,
  outcome: FollowCheck,
): Promise<void> {
  const tickets = await sql<{ connection: string; external_id: string }[]>`
    select c.slug as connection, wi.external_id
    from work_item_follow_notes n
    join work_items wi on wi.id = n.work_item_id
    join source_connections c on c.id = wi.source_connection_id
    where n.user_id = ${userId} and n.source_connection_id = ${connectionId}
      and n.external_id = ${change.id}
  `;
  for (const ticket of tickets) {
    const resolved = await resolvePersonalSource(ticket.connection, userId);
    if (!resolved?.source.postNote) {
      outcome.notes_skipped++;
      continue;
    }
    try {
      await resolved.source.postNote(ticket.external_id, changeNote(change), {
        private: true,
      });
      outcome.notes++;
    } catch (e) {
      log("warn", "follow_note_failed", {
        connection: ticket.connection,
        error: errorText(e),
      });
      outcome.notes_skipped++;
    }
  }
}
