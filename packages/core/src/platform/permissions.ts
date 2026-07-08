import { sql } from "./db";
import { forbidden } from "./errors";

// Delegated authorization, shared by the HTTP API and the MCP server so the two
// adapters can never drift: a global admin can do everything; a team mini-admin
// (team_members.role = 'admin') curates knowledge/docs/taxonomy/membership for
// their teams only.

export interface EntryScope {
  productId?: string | null;
  teamId?: string | null;
}

interface PermissionContext {
  isGlobalAdmin: boolean;
  // team_id -> team_slug for every team the user is a mini-admin of
  teamAdmin: Map<string, string>;
}

// The MCP server is spawned per agent turn and the API resolves permissions on
// every guarded write, so cache the per-user context briefly instead of
// re-querying per tool call.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { ctx: PermissionContext; expires: number }>();

export function clearPermissionCache(): void {
  cache.clear();
}

async function contextFor(userId: string): Promise<PermissionContext> {
  const hit = cache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.ctx;
  const rows = await sql`
    select u.role as user_role, t.id as team_id, t.slug as team_slug
    from users u
    left join team_members tm on tm.user_id = u.id and tm.role = 'admin'
    left join teams t on t.id = tm.team_id
    where u.id = ${userId} and not u.disabled
  `;
  const ctx: PermissionContext = {
    isGlobalAdmin: rows.length > 0 && rows[0].user_role === "admin",
    teamAdmin: new Map(
      rows.filter((r) => r.team_id).map((r) => [r.team_id as string, r.team_slug as string]),
    ),
  };
  cache.set(userId, { ctx, expires: Date.now() + CACHE_TTL_MS });
  return ctx;
}

export async function isGlobalAdmin(userId: string): Promise<boolean> {
  return (await contextFor(userId)).isGlobalAdmin;
}

export async function teamAdminTeams(userId: string): Promise<{ team_id: string; team_slug: string }[]> {
  const ctx = await contextFor(userId);
  return [...ctx.teamAdmin].map(([team_id, team_slug]) => ({ team_id, team_slug }));
}

export async function isAnyTeamAdmin(userId: string): Promise<boolean> {
  const ctx = await contextFor(userId);
  return ctx.isGlobalAdmin || ctx.teamAdmin.size > 0;
}

// True when the user may curate content in the given scope: global admin, team
// mini-admin of scope.teamId, or of the team owning scope.productId. A scope
// with neither id set is org-global -> global admin only.
export async function canEditScope(userId: string, scope: EntryScope): Promise<boolean> {
  const ctx = await contextFor(userId);
  if (ctx.isGlobalAdmin) return true;
  if (ctx.teamAdmin.size === 0) return false;
  if (scope.teamId && ctx.teamAdmin.has(scope.teamId)) return true;
  if (scope.productId) {
    const [row] = await sql`select team_id from products where id = ${scope.productId}`;
    if (row?.team_id && ctx.teamAdmin.has(row.team_id as string)) return true;
  }
  return false;
}

export async function canManageTeam(userId: string, teamId: string): Promise<boolean> {
  const ctx = await contextFor(userId);
  return ctx.isGlobalAdmin || ctx.teamAdmin.has(teamId);
}

export async function canManageTeamBySlug(userId: string, teamSlug: string): Promise<boolean> {
  const ctx = await contextFor(userId);
  return ctx.isGlobalAdmin || [...ctx.teamAdmin.values()].includes(teamSlug);
}

// assert* variants throw the shared `forbidden` error so both adapters surface
// identical messages (HTTP 403 / MCP tool error).

export async function assertCanEditScope(userId: string, scope: EntryScope): Promise<void> {
  if (!(await canEditScope(userId, scope)))
    throw forbidden("you don't have curation rights for this team/product");
}

export async function assertCanManageTeamBySlug(userId: string, teamSlug: string): Promise<void> {
  if (!(await canManageTeamBySlug(userId, teamSlug)))
    throw forbidden(`you don't have admin rights for team '${teamSlug}'`);
}

export async function assertAnyTeamAdmin(userId: string): Promise<void> {
  if (!(await isAnyTeamAdmin(userId)))
    throw forbidden("this action requires team-admin or admin rights");
}

export async function assertGlobalAdmin(userId: string): Promise<void> {
  if (!(await isGlobalAdmin(userId)))
    throw forbidden("this action requires global admin rights");
}
