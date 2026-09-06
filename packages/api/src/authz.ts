import type { Context } from "hono";
import {
  getUserByEmail,
  env,
  forbidden,
  assertCanEditScope,
  assertCanManageTeamBySlug,
  assertAnyTeamAdmin,
  userSoleTeamId,
  type EntryScope,
  type ScopeContext,
  type ActorRef,
} from "@tachy/core";
import { getIdentity } from "./auth";

export async function callerUserId(c: Context): Promise<string | null> {
  const email = getIdentity(c)?.email ?? env.userEmail;
  if (!email) return null;
  return (await getUserByEmail(email))?.id ?? null;
}

/**
 * Who is making this edit, for the library revision it will produce. A bearer
 * token carries no email at all, so it is recorded as `api` rather than being
 * passed off as a person who happened to be signed in.
 */
export async function callerActor(c: Context): Promise<ActorRef> {
  const via = getIdentity(c)?.via;
  return {
    userId: await callerUserId(c),
    actor: via === "token" ? "api" : "web",
  };
}

/** Scope for user → team → global credential/preference lookups. */
export async function callerScope(c: Context): Promise<ScopeContext> {
  const userId = await callerUserId(c);
  if (!userId) return {};
  return { userId, teamId: (await userSoleTeamId(userId)) ?? undefined };
}

function isAdminIdentity(c: Context): boolean {
  return getIdentity(c)?.role === "admin";
}

export async function requireCaller(c: Context): Promise<string> {
  const id = await callerUserId(c);
  if (!id) throw forbidden("no user account is associated with this session");
  return id;
}

export async function assertScopeEditor(
  c: Context,
  scope: EntryScope,
): Promise<void> {
  if (isAdminIdentity(c)) return;
  await assertCanEditScope(await requireCaller(c), scope);
}

export async function assertTeamAdmin(
  c: Context,
  teamSlug: string,
): Promise<void> {
  if (isAdminIdentity(c)) return;
  await assertCanManageTeamBySlug(await requireCaller(c), teamSlug);
}

export async function assertAnyTeamAdminApi(c: Context): Promise<void> {
  if (isAdminIdentity(c)) return;
  await assertAnyTeamAdmin(await requireCaller(c));
}
