import { MAX_PAGE } from "@tachy/contract";
import type { AuditAction, AuditEventRow } from "@tachy/contract";
import { sql, jsonb } from "../infra/db";
import { maskSecrets } from "../infra/known-secrets";
import type { ActorRef } from "../library/revisions";

export interface AuditEvent {
  actor: ActorRef;
  action: AuditAction;
  target?: string | null;
  /** Names and choices, never a secret's value: what was set, not to what. */
  detail?: Record<string, unknown>;
  address?: string | null;
}

/**
 * Adds one row to the trail. It throws like any write, so an action that cannot
 * be recorded fails rather than going unrecorded.
 */
export async function recordAudit(event: AuditEvent): Promise<void> {
  const detail = JSON.parse(maskSecrets(JSON.stringify(event.detail ?? {})));
  const userId = event.actor.userId ?? null;
  await sql`
    insert into audit_events
      (actor_user_id, actor_email, actor, action, target, detail, address)
    values (${userId}, (select email from users where id = ${userId}),
            ${event.actor.actor}, ${event.action}, ${event.target ?? null},
            ${jsonb(detail)}, ${event.address ?? null})
  `;
}

/** Newest first. `before` is the id of the last row of the previous page. */
export async function listAudit(
  page: { before?: string; limit?: number; action?: AuditAction } = {},
): Promise<AuditEventRow[]> {
  const limit = Math.min(Math.max(page.limit ?? MAX_PAGE, 1), MAX_PAGE);
  return sql<AuditEventRow[]>`
    select id::text as id, at, actor_email, actor, action, target, detail, address
    from audit_events
    where true
      ${page.before ? sql`and id < ${page.before}::bigint` : sql``}
      ${page.action ? sql`and action = ${page.action}` : sql``}
    order by audit_events.id desc
    limit ${limit}
  `;
}
