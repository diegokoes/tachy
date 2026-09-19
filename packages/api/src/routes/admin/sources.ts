import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  listSourceConnections,
  addSourceConnection,
  deleteSourceConnection,
  resolveSource,
  secretsEnabled,
  credentialSource,
  setCredential,
  sourceCredentialName,
  badInput,
  SLUG_RE,
  type CredentialSource,
  type ScopeContext,
} from "@tachy/core";
import { requireAdmin } from "../../auth";
import { callerScope, requireCaller } from "../../authz";

/** Strict, because it becomes a credential name and an env var suffix. */
const connSlugField = z
  .string()
  .regex(
    SLUG_RE,
    "connection slug must be lowercase letters, digits and hyphens",
  );

const sourceConnSchema = z.object({
  sourceType: z.string(),
  slug: connSlugField,
  baseUrl: z.string().optional(),
  config: z.record(z.string(), z.any()).optional(),
  /** Stored as the connection's global credential; never echoed back. */
  token: z.string().min(1).optional(),
});

/** Where the caller's token for a connection comes from — null when unset.
 *  Connections predating `connSlugField` may carry names the vault rejects. */
export async function tokenSource(
  sourceType: string,
  slug: string,
  ctx: ScopeContext,
): Promise<CredentialSource | null> {
  try {
    return (
      (await credentialSource(sourceCredentialName(sourceType, slug), ctx)) ??
      null
    );
  } catch {
    return null;
  }
}

/**
 * Slugs of the connections whose token the caller's scope cannot resolve.
 * Through the same resolver the connections list uses, not a join against the
 * vault: a token supplied by the environment counts as a token.
 */
export async function untokenedConnections(
  ctx: ScopeContext,
): Promise<string[]> {
  const conns = await listSourceConnections();
  const found = await Promise.all(
    conns.map((r) => tokenSource(r.source_type, r.slug, ctx)),
  );
  return conns.filter((_, i) => found[i] === null).map((r) => r.slug);
}

/** Source connections: registering them, their tokens, and testing them. */
export const sources = new Hono()
  .get("/source-connections", async (c) => {
    const ctx = await callerScope(c);
    const rows = await listSourceConnections();
    return c.json(
      await Promise.all(
        rows.map(async (r) => ({
          ...r,
          token_source: await tokenSource(r.source_type, r.slug, ctx),
        })),
      ),
    );
  })
  .post(
    "/source-connections",
    requireAdmin,
    zValidator("json", sourceConnSchema),
    async (c) => {
      const { token, ...conn } = c.req.valid("json");
      if (token && !secretsEnabled())
        throw badInput("credential storage disabled: set TACHY_SECRET_KEY");
      const actor = token ? await requireCaller(c) : null;
      const row = await addSourceConnection(conn);
      if (token && actor)
        await setCredential(
          actor,
          "global",
          undefined,
          sourceCredentialName(conn.sourceType, conn.slug),
          token,
        );
      return c.json(row);
    },
  )
  .delete("/source-connections/:slug", requireAdmin, async (c) => {
    return c.json(await deleteSourceConnection(c.req.param("slug")!));
  })
  // Cheapest authenticated call the remote API offers, using the caller's own
  // token. Doubles as discovery of the groups worth registering as projects.
  .post("/source-connections/:slug/test", requireAdmin, async (c) => {
    const slug = c.req.param("slug")!;
    try {
      const { source } = await resolveSource(slug, await callerScope(c));
      if (!source.verify)
        return c.json({
          ok: false,
          error: "this source type has no test call",
        });
      const probe = await source.verify();
      return c.json({ ok: true, ...probe });
    } catch (e) {
      return c.json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
