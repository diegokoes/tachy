import { LIBRARY_ACTORS } from "@tachy/contract";
import type { LibraryActor } from "@tachy/contract";
import { sql, jsonb } from "../infra/db";
import type { Db } from "../infra/db";
import { badInput, conflict, notFound } from "../infra/errors";

export { LIBRARY_ACTORS };
export type { LibraryActor };

/**
 * Which library item a revision or a view is about. Exactly one is set — the
 * two-nullable-targets shape the tables use.
 */
export type LibraryTarget =
  | { entryId: string; docId?: undefined }
  | { docId: string; entryId?: undefined };

/**
 * Who made an edit, and through which door. `userId` is the human either way:
 * an agent edit is attributed to the person whose turn spawned the MCP
 * subprocess, so `actor` is what separates a manual edit from one the agent
 * made on their behalf.
 */
export interface ActorRef {
  userId?: string | null;
  actor: LibraryActor;
  turnId?: string | null;
}

/** For a write that reached core without saying which door it came through. */
export const UNKNOWN_ACTOR: ActorRef = { actor: "api", userId: null };

function targetWhere(t: LibraryTarget) {
  if (t.entryId) return sql`r.knowledge_entry_id = ${t.entryId}`;
  if (t.docId) return sql`r.reference_doc_id = ${t.docId}`;
  throw badInput("a library target needs an entry id or a doc id");
}

/**
 * The row reduced to what a reader would call its content. Ids, timestamps and
 * the version counter are the row's identity rather than its substance, and the
 * embedding and generated search columns are excluded because they are derived
 * — and because a vector is larger than the text it came from.
 */
export function snapshotOf(row: Record<string, any>): Record<string, unknown> {
  const skip = new Set([
    "id",
    "version",
    "created_at",
    "updated_at",
    "embedding",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (skip.has(k) || k.startsWith("search_")) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Which keys differ between two snapshots. Arrays compare by content, so
 * re-saving the same tags is not an edit. Everything else compares by JSON,
 * which reports a re-ordered `structured` blob as changed — cheap and honest,
 * rather than a deep-equality guess that could hide a real edit.
 */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const k of keys) {
    const a = before[k];
    const b = after[k];
    if (Array.isArray(a) || Array.isArray(b)) {
      const norm = (v: unknown) => (Array.isArray(v) ? v.join("\0") : "");
      if (norm(a) !== norm(b)) changed.push(k);
      continue;
    }
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null))
      changed.push(k);
  }
  return changed.sort();
}

/**
 * Append one revision. Takes the transaction the caller is already inside, so
 * the row update and its history entry commit together or not at all.
 */
export async function recordRevision(
  db: Db,
  target: LibraryTarget,
  version: number,
  actor: ActorRef,
  snapshot: Record<string, unknown>,
  changed: string[],
): Promise<void> {
  await db`
    insert into library_revisions
      (knowledge_entry_id, reference_doc_id, version, user_id, actor, turn_id,
       changed_fields, snapshot)
    values
      (${target.entryId ?? null}, ${target.docId ?? null}, ${version},
       ${actor.userId ?? null}, ${actor.actor}, ${actor.turnId ?? null},
       ${changed}, ${jsonb(snapshot)})
    on conflict do nothing
  `;
}

/** A library row as an insert or update returns it with its revision columns. */
export type RevisedRow = {
  id: string;
  version: number;
  status: string;
} & Record<string, unknown>;

/** The optimistic lock an update checks before it reads anything else. */
export function assertExpectedVersion(
  current: number,
  expected: number | null | undefined,
): void {
  if (expected != null && current !== expected)
    throw conflict(`Version conflict: expected ${expected}, found ${current}`);
}

/**
 * The row an `update ... where version = <read version> returning` gave back.
 * None means another write landed between the read and the update.
 */
export function assertUpdated<T>(
  row: T | undefined,
  what: string,
): asserts row is T {
  if (!row)
    throw conflict(`Version conflict: ${what} was updated concurrently`);
}

/**
 * Append the revision for an update, inside its transaction, and answer with
 * what every library update returns.
 */
export async function recordUpdate(
  db: Db,
  target: LibraryTarget,
  before: Record<string, unknown>,
  after: RevisedRow,
  actor: ActorRef,
): Promise<{ id: string; status: string; version: number }> {
  const snapshot = snapshotOf(after);
  await recordRevision(
    db,
    target,
    after.version,
    actor,
    snapshot,
    changedFields(snapshotOf(before), snapshot),
  );
  return { id: after.id, status: after.status, version: after.version };
}

export interface RevisionRow {
  id: string;
  version: number;
  actor: LibraryActor;
  turn_id: string | null;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  changed_fields: string[];
  created_at: string;
}

/** Newest first. Snapshots are omitted — forty of them is a payload, not a list. */
export async function listRevisions(
  target: LibraryTarget,
): Promise<RevisionRow[]> {
  return sql`
    select r.id, r.version, r.actor, r.turn_id, r.user_id,
           u.email as user_email, u.display_name as user_name,
           r.changed_fields, r.created_at
    from library_revisions r
    left join users u on u.id = r.user_id
    where ${targetWhere(target)}
    order by r.version desc
  ` as Promise<RevisionRow[]>;
}

export async function getRevision(
  target: LibraryTarget,
  version: number,
): Promise<RevisionRow & { snapshot: Record<string, unknown> }> {
  const [row] = await sql`
    select r.id, r.version, r.actor, r.turn_id, r.user_id,
           u.email as user_email, u.display_name as user_name,
           r.changed_fields, r.snapshot, r.created_at
    from library_revisions r
    left join users u on u.id = r.user_id
    where ${targetWhere(target)} and r.version = ${version}
  `;
  if (!row) throw notFound(`No revision ${version} for this library item`);
  return row as RevisionRow & { snapshot: Record<string, unknown> };
}

/**
 * The patch that turns the live row back into what `version` held, restricted to
 * fields the caller may set. Reverting is an ordinary edit: it produces a new
 * revision on top and never rewrites history.
 */
export function revertPatch(
  snapshot: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (k in snapshot) patch[k] = snapshot[k];
  if (!Object.keys(patch).length)
    throw badInput("that revision holds no restorable fields");
  return patch;
}
