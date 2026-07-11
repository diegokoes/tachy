import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  forbidden,
  badInput,
  secretsEnabled,
  listCredentials,
  setCredential,
  deleteCredential,
  assertGlobalAdmin,
  canManageTeam,
  getTeamIdBySlug,
  setPref,
  deletePref,
  type Scope,
} from "@tachy/core";
import { requireCaller } from "../authz";
import type { Context } from "hono";

const scopeSchema = z.enum(["global", "team"]);

async function resolveScopeTarget(
  c: Context,
  actor: string,
  scope: "global" | "team",
  teamSlug?: string,
): Promise<string | undefined> {
  if (scope === "global") {
    await assertGlobalAdmin(actor);
    return undefined;
  }
  if (!teamSlug) throw badInput("team scope requires ?team=<slug>");
  const teamId = await getTeamIdBySlug(teamSlug);
  if (!(await canManageTeam(actor, teamId)))
    throw forbidden(`you don't have admin rights for team '${teamSlug}'`);
  return teamId;
}

const putSchema = z.object({
  scope: scopeSchema,
  team: z.string().optional(),
  name: z.string().min(1),
  value: z.string().min(1),
});
const deleteSchema = putSchema.omit({ value: true });
const prefPutSchema = z.object({
  scope: scopeSchema,
  team: z.string().optional(),
  key: z.string().min(1),
  value: z.unknown(),
});
const prefDeleteSchema = prefPutSchema.omit({ value: true });

/** Admin/team-admin management of shared (global + team) scopes.
 *  Responses carry metadata only — plaintext never leaves the server. */
export const credentials = new Hono()

  .get("/", async (c) => {
    const actor = await requireCaller(c);
    const parsed = scopeSchema.safeParse(c.req.query("scope") ?? "global");
    if (!parsed.success) throw badInput("scope must be 'global' or 'team'");
    const scope = parsed.data;
    const teamId = await resolveScopeTarget(
      c,
      actor,
      scope,
      c.req.query("team"),
    );
    return c.json({
      vault_enabled: secretsEnabled(),
      credentials: secretsEnabled()
        ? await listCredentials(scope as Scope, teamId)
        : [],
    });
  })

  .put("/", zValidator("json", putSchema), async (c) => {
    const actor = await requireCaller(c);
    const { scope, team, name, value } = c.req.valid("json");
    const teamId = await resolveScopeTarget(c, actor, scope, team);
    await setCredential(actor, scope as Scope, teamId, name, value);
    return c.json({ ok: true });
  })

  .delete("/", zValidator("json", deleteSchema), async (c) => {
    const actor = await requireCaller(c);
    const { scope, team, name } = c.req.valid("json");
    const teamId = await resolveScopeTarget(c, actor, scope, team);
    const deleted = await deleteCredential(actor, scope as Scope, teamId, name);
    return c.json({ ok: true, deleted });
  })

  .put("/preferences", zValidator("json", prefPutSchema), async (c) => {
    const actor = await requireCaller(c);
    const { scope, team, key, value } = c.req.valid("json");
    const teamId = await resolveScopeTarget(c, actor, scope, team);
    await setPref(actor, scope as Scope, teamId, key, value);
    return c.json({ ok: true });
  })

  .delete("/preferences", zValidator("json", prefDeleteSchema), async (c) => {
    const actor = await requireCaller(c);
    const { scope, team, key } = c.req.valid("json");
    const teamId = await resolveScopeTarget(c, actor, scope, team);
    const deleted = await deletePref(actor, scope as Scope, teamId, key);
    return c.json({ ok: true, deleted });
  });
