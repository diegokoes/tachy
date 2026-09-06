import {
  resolveCurrentUserId,
  sql,
  countAdmins,
  forbidden,
  canManageTeam,
  assertCanEditScope,
  assertAnyTeamAdmin,
  assertGlobalAdmin,
  env,
} from "@tachy/core";
import type { ActorRef, EntryScope } from "@tachy/core";

/** Who is calling, and whether they may. */
export let enforcementCache = false;
export async function enforcementActive(): Promise<boolean> {
  if (enforcementCache) return true;
  enforcementCache = (await countAdmins()) > 0;
  return enforcementCache;
}

/**
 * Who this subprocess is writing as. The user is the same either way — the API
 * builds this env per turn from the caller's session — so `actor` is what says
 * whether an edit came from an agent turn or from someone's own MCP client.
 */
export async function mcpActor(): Promise<ActorRef> {
  return {
    userId: await resolveCurrentUserId(),
    actor: env.actor === "agent" ? "agent" : "mcp",
    turnId: env.turnId ?? null,
  };
}

export async function gateUserId(): Promise<string | null> {
  const userId = await resolveCurrentUserId();
  if (!userId) return null;
  return (await enforcementActive()) ? userId : null;
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
    throw forbidden("you don't have admin rights for this team");
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

export async function newEntryScope(i: {
  productId?: string | null;
  teamId?: string | null;
  workItemId?: string | null;
}): Promise<EntryScope> {
  if (i.productId || i.teamId)
    return { productId: i.productId, teamId: i.teamId };
  if (i.workItemId) {
    const [wi] =
      await sql`select product_id, team_id from work_items where id = ${i.workItemId}`;
    if (wi) return { productId: wi.product_id, teamId: wi.team_id };
  }
  return {};
}

/*
 * Named once, used by both save_knowledge_entry and update_knowledge_entry.
 * The update tool's copies were bare — no description at all — so the model got
 * the guidance on the call that creates an entry and none on the call that
 * rewrites one. Naming them is also what stops the two drifting.
 */
