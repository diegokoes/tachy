/** Who is calling, and whether they may. */
import {
  resolveCurrentUserId,
  adminCount,
  canManageTeam,
  assertCanEditScope,
  assertAnyTeamAdmin,
  assertGlobalAdmin,
} from "@tachy/core/access";
import { sql, forbidden, env } from "@tachy/core/infra";
import type { AuditAction } from "@tachy/core";
import { recordAudit } from "@tachy/core/audit";
import type { ActorRef } from "@tachy/core/library";
import type { EntryScope } from "@tachy/core/access";

export let enforcementCache = false;
export async function enforcementActive(): Promise<boolean> {
  if (enforcementCache) return true;
  enforcementCache = (await adminCount()) > 0;
  return enforcementCache;
}

/**
 * Who this subprocess is writing as. The user is the same either way - the API
 * builds this env per turn from the caller's session - so `actor` is what says
 * whether an edit came from an agent turn or from someone's own MCP client.
 */
export async function mcpActor(): Promise<ActorRef> {
  return {
    userId: await resolveCurrentUserId(),
    actor: env.actor === "agent" ? "agent" : "mcp",
    turnId: env.turnId ?? null,
  };
}

/** Runs the write, then records it: a refused or failed write leaves no row. */
export async function audited<T>(
  action: AuditAction,
  target: string,
  write: () => Promise<T>,
): Promise<T> {
  const result = await write();
  await recordAudit({ actor: await mcpActor(), action, target });
  return result;
}

/**
 * The user the gates check, or null when nothing is checked: no admin exists
 * yet, or the session is an app admin with no user row. A session that names
 * nobody is otherwise refused.
 */
export async function gateUserId(): Promise<string | null> {
  if (!(await enforcementActive())) return null;
  const userId = await resolveCurrentUserId();
  if (userId) return userId;
  if (env.actorRole === "admin") return null;
  throw forbidden(
    "no user is attached to this session: set TACHY_USER_EMAIL to act as one",
  );
}

export async function requireCanEdit(scope: EntryScope): Promise<void> {
  const userId = await gateUserId();
  if (userId) await assertCanEditScope(userId, scope);
}

export async function requireCanManageTeam(
  teamId: string | null | undefined,
): Promise<void> {
  const userId = await gateUserId();
  if (!userId) return;
  if (!teamId || !(await canManageTeam(userId, teamId)))
    throw forbidden("you don't have team admin rights for this team");
}

export async function requireAnyTeamAdmin(): Promise<void> {
  const userId = await gateUserId();
  if (userId) await assertAnyTeamAdmin(userId);
}

export async function requireGlobalAdmin(): Promise<void> {
  const userId = await gateUserId();
  if (userId) await assertGlobalAdmin(userId);
}

export async function knowledgeEntryScope(id: string): Promise<EntryScope> {
  const [row] =
    await sql`select product_id, team_id from knowledge_entries where id = ${id}`;
  return row ? { productId: row.product_id, teamId: row.team_id } : {};
}

export async function referenceDocScope(id: string): Promise<EntryScope> {
  const [row] =
    await sql`select product_id, team_id from reference_docs where id = ${id}`;
  return row ? { productId: row.product_id, teamId: row.team_id } : {};
}

export async function newEntryScope(input: {
  productId?: string | null;
  teamId?: string | null;
  workItemId?: string | null;
}): Promise<EntryScope> {
  if (input.productId || input.teamId)
    return { productId: input.productId, teamId: input.teamId };
  if (input.workItemId) {
    const [workItem] =
      await sql`select product_id, team_id from work_items where id = ${input.workItemId}`;
    if (workItem)
      return { productId: workItem.product_id, teamId: workItem.team_id };
  }
  return {};
}
