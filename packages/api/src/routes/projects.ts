import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  SOURCE_PROJECT_ROLES,
  addSourceProject,
  deleteProjectAreaMap,
  deleteSourceProject,
  getProductIdBySlug,
  getTeamIdBySlug,
  listProjectAreaMap,
  listSourceProjects,
  resolveCredential,
  resolveProjectContext,
  setProjectAreaMap,
  sourceCredentialName,
  sourceProjectScope,
  sql,
  updateSourceProject,
} from "@tachy/core";
import { createAdoClient } from "@tachy/source-azure-devops";
import { assertScopeEditor, assertTeamAdmin, callerScope } from "../authz";
import type { Context } from "hono";

const wikiSchema = z.object({
  identifier: z.string().min(1),
  name: z.string().optional(),
  root_path: z.string().optional(),
});

const projectSchema = z.object({
  source_slug: z.string(),
  external_key: z.string().min(1),
  name: z.string().optional(),
  role: z.enum(SOURCE_PROJECT_ROLES),
  product_slug: z.string().optional(),
  team_slug: z.string().optional(),
  wiki: wikiSchema.nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().nullable().optional(),
});

const projectPatchSchema = z.object({
  name: z.string().optional(),
  role: z.enum(SOURCE_PROJECT_ROLES).optional(),
  product_slug: z.string().nullable().optional(),
  team_slug: z.string().optional(),
  wiki: wikiSchema.nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().nullable().optional(),
});

const areaSchema = z.object({
  area_prefix: z.string().min(1),
  component_slug: z.string().min(1),
});

/** A knowledge project is scoped by its product, a tracker by its team. */
async function assertCanWriteProject(
  c: Context,
  role: string,
  productSlug?: string | null,
  teamSlug?: string,
): Promise<void> {
  if (role === "knowledge") {
    if (!productSlug) return;
    await assertScopeEditor(c, {
      productId: await getProductIdBySlug(productSlug),
    });
    return;
  }
  if (teamSlug) await assertTeamAdmin(c, teamSlug);
}

/** ADO client for a connection, using the caller's own PAT. */
async function adoClient(c: Context, slug: string) {
  const [conn] = await sql`
    select id, source_type, slug, base_url, config
    from source_connections where slug = ${slug}
  `;
  if (!conn) throw new Error(`Unknown source connection: ${slug}`);
  if (conn.source_type !== "azure-devops")
    throw new Error(`'${slug}' is a ${conn.source_type} connection`);
  const token = await resolveCredential(
    sourceCredentialName(conn.source_type, conn.slug),
    await callerScope(c),
  );
  return createAdoClient({
    baseUrl: conn.base_url ?? "",
    slug: conn.slug,
    config: conn.config ?? {},
    ...(token ? { token } : {}),
  });
}

/** Remote calls answer with {ok:false} so the setup UI can render the reason. */
async function probe<T>(fn: () => Promise<T>) {
  try {
    return { ok: true as const, ...(await fn()) };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export const projects = new Hono()

  .get("/source-projects", async (c) => {
    const productSlug = c.req.query("product_slug");
    const teamSlug = c.req.query("team_slug");
    const role = c.req.query("role");
    return c.json(
      await listSourceProjects({
        sourceSlug: c.req.query("source"),
        productId: productSlug
          ? await getProductIdBySlug(productSlug)
          : undefined,
        teamId: teamSlug ? await getTeamIdBySlug(teamSlug) : undefined,
        role: role === "knowledge" || role === "tracker" ? role : undefined,
      }),
    );
  })

  .get("/source-projects/context", async (c) => {
    const productSlug = c.req.query("product_slug");
    return c.json(
      await resolveProjectContext({
        productSlug: productSlug || undefined,
        sourceSlug: c.req.query("source") || undefined,
        externalKey: c.req.query("external_key") || undefined,
        workItemId: c.req.query("work_item_id") || undefined,
      }),
    );
  })

  .post("/source-projects", zValidator("json", projectSchema), async (c) => {
    const b = c.req.valid("json");
    await assertCanWriteProject(c, b.role, b.product_slug, b.team_slug);
    return c.json(
      await addSourceProject({
        sourceSlug: b.source_slug,
        externalKey: b.external_key,
        name: b.name,
        role: b.role,
        productSlug: b.product_slug,
        teamSlug: b.team_slug,
        wiki: b.wiki,
        config: b.config,
        notes: b.notes,
      }),
    );
  })

  .patch(
    "/source-projects/:id",
    zValidator("json", projectPatchSchema),
    async (c) => {
      const id = c.req.param("id");
      await assertScopeEditor(c, await sourceProjectScope(id));
      const b = c.req.valid("json");
      // Re-pointing a project needs rights on where it lands, too.
      if (b.role || b.product_slug !== undefined || b.team_slug)
        await assertCanWriteProject(
          c,
          b.role ?? "knowledge",
          b.product_slug,
          b.team_slug,
        );
      return c.json(
        await updateSourceProject(id, {
          name: b.name,
          role: b.role,
          productSlug: b.product_slug,
          teamSlug: b.team_slug,
          wiki: b.wiki,
          config: b.config,
          notes: b.notes,
        }),
      );
    },
  )

  .delete("/source-projects/:id", async (c) => {
    const id = c.req.param("id");
    await assertScopeEditor(c, await sourceProjectScope(id));
    return c.json(await deleteSourceProject(id));
  })

  .get("/source-projects/:id/areas", async (c) =>
    c.json(await listProjectAreaMap(c.req.param("id"))),
  )

  .put(
    "/source-projects/:id/areas",
    zValidator("json", areaSchema),
    async (c) => {
      const id = c.req.param("id");
      await assertScopeEditor(c, await sourceProjectScope(id));
      const { area_prefix, component_slug } = c.req.valid("json");
      return c.json(
        await setProjectAreaMap({
          sourceProjectId: id,
          areaPrefix: area_prefix,
          componentSlug: component_slug,
        }),
      );
    },
  )

  .delete("/source-projects/:id/areas/:areaId", async (c) => {
    await assertScopeEditor(c, await sourceProjectScope(c.req.param("id")));
    return c.json(await deleteProjectAreaMap(c.req.param("areaId")));
  })

  // Live discovery for the setup screens — read-only, never writes anything.
  .get("/source-connections/:slug/discover/projects", async (c) =>
    c.json(
      await probe(async () => {
        const client = await adoClient(c, c.req.param("slug"));
        const found = await client.listProjects();
        return { projects: found.map((p) => ({ key: p.name, name: p.name })) };
      }),
    ),
  )

  .get("/source-connections/:slug/discover/wikis", async (c) =>
    c.json(
      await probe(async () => {
        const client = await adoClient(c, c.req.param("slug"));
        const found = await client.listWikis(c.req.query("project"));
        return {
          wikis: found.map((w) => ({
            identifier: w.name,
            name: w.name,
            type: w.type,
          })),
        };
      }),
    ),
  )

  .get("/source-connections/:slug/discover/repos", async (c) =>
    c.json(
      await probe(async () => {
        const project = c.req.query("project");
        if (!project) throw new Error("project is required");
        const client = await adoClient(c, c.req.param("slug"));
        const found = await client.listRepos(project);
        return {
          repos: found.map((r) => ({
            name: r.name,
            url: r.remoteUrl ?? r.webUrl ?? "",
            default_branch: (r.defaultBranch ?? "").replace(
              /^refs\/heads\//,
              "",
            ),
          })),
        };
      }),
    ),
  );
