import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  badInput,
  getTeamIdBySlug,
  listVisibleArtifacts,
  getArtifact,
  upsertArtifact,
  deleteArtifact,
  userSoleTeamId,
  type Scope,
  type ScopeContext,
} from "@tachy/core";
import { requireCaller } from "../authz";

const scopeSchema = z.enum(["global", "team", "user"]);

const putSchema = z.object({
  scope: scopeSchema,
  team: z.string().optional(),
  slug: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  body: z.string().min(1),
});
const deleteSchema = putSchema.pick({ scope: true, team: true, slug: true });

async function callerContext(userId: string): Promise<ScopeContext> {
  return { userId, teamId: (await userSoleTeamId(userId)) ?? undefined };
}

async function scopeTarget(
  actor: string,
  scope: Scope,
  teamSlug?: string,
): Promise<string | undefined> {
  if (scope === "user") return actor;
  if (scope === "global") return undefined;
  if (!teamSlug) throw badInput("team scope requires a team slug");
  return getTeamIdBySlug(teamSlug);
}

export const artifacts = new Hono()

  .get("/", async (c) => {
    const userId = await requireCaller(c);
    return c.json(await listVisibleArtifacts(await callerContext(userId)));
  })

  .get("/:id", async (c) => {
    const userId = await requireCaller(c);
    return c.json(
      await getArtifact(c.req.param("id"), await callerContext(userId)),
    );
  })

  .put("/", zValidator("json", putSchema), async (c) => {
    const actor = await requireCaller(c);
    const { scope, team, slug, title, description, body } = c.req.valid("json");
    const scopeId = await scopeTarget(actor, scope, team);
    await upsertArtifact(actor, scope, scopeId, slug, {
      title,
      description,
      body,
    });
    return c.json({ ok: true });
  })

  .delete("/", zValidator("json", deleteSchema), async (c) => {
    const actor = await requireCaller(c);
    const { scope, team, slug } = c.req.valid("json");
    const scopeId = await scopeTarget(actor, scope, team);
    const deleted = await deleteArtifact(actor, scope, scopeId, slug);
    return c.json({ ok: true, deleted });
  });
