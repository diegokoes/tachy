import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  assertGlobalAdmin,
  badInput,
  getRepoBySlug,
  getUserByEmail,
  indexRepo,
  linkRepo,
  listRepos,
  deleteRepo,
  log,
  resolveCredential,
  secretsEnabled,
  sourceCredentialName,
  sql,
  userSoleTeamId,
  type ScopeContext,
} from "@tachy/core";
import { requireCaller } from "../authz";
import { getIdentity } from "../auth";
import type { Context } from "hono";

const linkSchema = z.object({
  slug: z.string().min(1),
  url: z.string().min(1),
  product: z.string().optional(),
  source: z.string().optional(),
  branch: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const inFlight = new Set<string>();

async function callerCtx(c: Context): Promise<ScopeContext> {
  const email = getIdentity(c)?.email;
  const user = email ? await getUserByEmail(email) : null;
  if (!user) return {};
  return {
    userId: user.id,
    teamId: (await userSoleTeamId(user.id)) ?? undefined,
  };
}

async function resolveRepoToken(
  c: Context,
  sourceSlug: string | null,
): Promise<string | undefined> {
  if (!sourceSlug || !secretsEnabled()) return undefined;
  const [conn] = await sql`
    select source_type from source_connections where slug = ${sourceSlug}
  `;
  if (!conn) return undefined;
  return resolveCredential(
    sourceCredentialName(conn.source_type, sourceSlug),
    await callerCtx(c),
  );
}

export const repos = new Hono()

  .get("/", async (c) => c.json({ repos: await listRepos() }))

  .put("/", zValidator("json", linkSchema), async (c) => {
    const actor = await requireCaller(c);
    await assertGlobalAdmin(actor);
    const body = c.req.valid("json");
    const row = await linkRepo({
      slug: body.slug,
      url: body.url,
      productSlug: body.product,
      sourceSlug: body.source,
      defaultBranch: body.branch,
      config: body.config,
    });
    return c.json({ ok: true, repo: row });
  })

  .post("/:slug/reindex", async (c) => {
    const actor = await requireCaller(c);
    await assertGlobalAdmin(actor);
    const slug = c.req.param("slug");
    const repo = await getRepoBySlug(slug);
    if (inFlight.has(slug))
      throw badInput(`repo '${slug}' is already being indexed`);

    const token = await resolveRepoToken(c, repo.source_slug);
    inFlight.add(slug);
    indexRepo(slug, { token })
      .catch((err) =>
        log("error", "repo_index_failed", {
          slug,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
      .finally(() => inFlight.delete(slug));
    return c.json({ ok: true, status: "started" }, 202);
  })

  .delete("/:slug", async (c) => {
    const actor = await requireCaller(c);
    await assertGlobalAdmin(actor);
    await deleteRepo(c.req.param("slug"));
    return c.json({ ok: true });
  });
