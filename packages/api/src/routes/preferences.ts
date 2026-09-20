import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  forbidden,
  badInput,
  assertGlobalAdmin,
  canManageTeam,
  getTeamIdBySlug,
  setPref,
  deletePref,
  type Scope,
} from "@tachy/core";
import { requireCaller } from "../authz";

const scopeSchema = z.enum(["global", "team"]);

async function resolveScopeTarget(
  actor: string,
  scope: "global" | "team",
  teamSlug?: string,
): Promise<string | undefined> {
  if (scope === "global") {
    await assertGlobalAdmin(actor);
    return undefined;
  }
  if (!teamSlug) throw badInput("team scope requires a team slug");
  const teamId = await getTeamIdBySlug(teamSlug);
  if (!(await canManageTeam(actor, teamId)))
    throw forbidden(`you don't have team admin rights for team '${teamSlug}'`);
  return teamId;
}

const putSchema = z.object({
  scope: scopeSchema,
  team: z.string().optional(),
  key: z.string().min(1),
  value: z.unknown(),
});
const deleteSchema = putSchema.omit({ value: true });

/** Admin/team-admin defaults for the scopes above a person. A user's own
 *  preferences live under /me/preferences. */
export const preferences = new Hono()

  .put("/", zValidator("json", putSchema), async (c) => {
    const actor = await requireCaller(c);
    const { scope, team, key, value } = c.req.valid("json");
    const teamId = await resolveScopeTarget(actor, scope, team);
    await setPref(actor, scope as Scope, teamId, key, value);
    return c.json({ ok: true });
  })

  .delete("/", zValidator("json", deleteSchema), async (c) => {
    const actor = await requireCaller(c);
    const { scope, team, key } = c.req.valid("json");
    const teamId = await resolveScopeTarget(actor, scope, team);
    const deleted = await deletePref(actor, scope as Scope, teamId, key);
    return c.json({ ok: true, deleted });
  });
