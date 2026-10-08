import { Hono } from "hono";
import { requireAdmin } from "../auth";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { badInput, notFound, sql, errorText } from "@tachy/core/infra";
import {
  addSourceProject,
  deleteProjectAreaMap,
  deleteSourceProject,
  listProjectAreaMap,
  listSourceProjects,
  resolveProjectContext,
  setProjectAreaMap,
  sourceProjectScope,
  updateSourceProject,
} from "@tachy/core/sources";
import { getProductIdBySlug, getTeamIdBySlug } from "@tachy/core/catalog";
import { connectionToken, releaseBranch } from "@tachy/core/code";
import { workItemDefaults, workItemSchema } from "@tachy/source-azure-devops";
import { assertScopeEditor, assertTeamAdmin, callerUserId } from "../authz";
import { adoClientFor } from "../azure-devops";
import type { Context } from "hono";

const wikiSchema = z.array(
  z.object({
    identifier: z.string().min(1),
    name: z.string().optional(),
    type: z.string().optional(),
    root_path: z.string().optional(),
    default: z.boolean().optional(),
  }),
);

const projectSchema = z.object({
  source_slug: z.string(),
  external_key: z.string().min(1),
  name: z.string().optional(),
  product_slug: z.string().nullable().optional(),
  team_slug: z.string().optional(),
  customer_slug: z.string().nullable().optional(),
  wikis: wikiSchema.nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().nullable().optional(),
});

const projectPatchSchema = z.object({
  name: z.string().optional(),
  product_slug: z.string().nullable().optional(),
  team_slug: z.string().optional(),
  customer_slug: z.string().nullable().optional(),
  wikis: wikiSchema.nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().nullable().optional(),
});

const areaSchema = z.object({
  area_prefix: z.string().min(1),
  component_slug: z.string().min(1),
});

/** A project with a product is scoped by it; one without, by its team. */
async function assertCanWriteProject(
  c: Context,
  productSlug?: string | null,
  teamSlug?: string,
): Promise<void> {
  if (productSlug) {
    await assertScopeEditor(c, {
      productId: await getProductIdBySlug(productSlug),
    });
    return;
  }
  if (teamSlug) await assertTeamAdmin(c, teamSlug);
}

/** Remotes asked at once which release branch they have. */
const DISCOVER_PROBES = 8;

/** Remote calls answer with {ok:false} so the setup UI can render the reason. */
async function probe<T>(call: () => Promise<T>) {
  try {
    return { ok: true as const, ...(await call()) };
  } catch (e) {
    return {
      ok: false as const,
      error: errorText(e),
    };
  }
}

/** `has_product` as the query string spells it; anything else is no filter. */
const QUERY_BOOLEAN = new Map([
  ["true", true],
  ["false", false],
]);

export const sourceProjects = new Hono()

  .get("/source-projects", async (c) => {
    const productSlug = c.req.query("product_slug");
    const teamSlug = c.req.query("team_slug");
    const hasProduct = c.req.query("has_product");
    return c.json(
      await listSourceProjects({
        sourceSlug: c.req.query("source"),
        productId: productSlug
          ? await getProductIdBySlug(productSlug)
          : undefined,
        teamId: teamSlug ? await getTeamIdBySlug(teamSlug) : undefined,
        hasProduct: QUERY_BOOLEAN.get(hasProduct ?? ""),
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
    const body = c.req.valid("json");
    await assertCanWriteProject(c, body.product_slug, body.team_slug);
    return c.json(
      await addSourceProject({
        sourceSlug: body.source_slug,
        externalKey: body.external_key,
        name: body.name,
        productSlug: body.product_slug,
        teamSlug: body.team_slug,
        customerSlug: body.customer_slug,
        wikis: body.wikis,
        config: body.config,
        notes: body.notes,
      }),
    );
  })

  .patch(
    "/source-projects/:id",
    zValidator("json", projectPatchSchema),
    async (c) => {
      const id = c.req.param("id");
      await assertScopeEditor(c, await sourceProjectScope(id));
      const body = c.req.valid("json");
      // Re-pointing a project needs rights on where it lands, too.
      if (body.product_slug !== undefined || body.team_slug)
        await assertCanWriteProject(c, body.product_slug, body.team_slug);
      return c.json(
        await updateSourceProject(id, {
          name: body.name,
          productSlug: body.product_slug,
          teamSlug: body.team_slug,
          customerSlug: body.customer_slug,
          wikis: body.wikis,
          config: body.config,
          notes: body.notes,
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

  // The field schema behind the chat approval box. Guarded, unlike the
  // discover/* routes: those are setup-screen probes, this is read on behalf of
  // whoever is composing a work item, and the PAT it uses is theirs.
  .get(
    "/source-connections/:slug/work-item-schema",
    requireAdmin,
    async (c) => {
      const project = c.req.query("project");
      const type = c.req.query("type");
      if (!project || !type) throw badInput("project and type are required");
      // Authorize before looking anything up: checking existence first would let
      // a non-curator probe which connection slugs exist.
      await assertScopeEditor(c, {});
      const [conn] = await sql`
      select config from source_connections where slug = ${c.req.param("slug")!}
    `;
      if (!conn) throw notFound(`Unknown source connection`);
      const { client } = await adoClientFor(c, c.req.param("slug")!);
      const defaults = workItemDefaults(conn.config, project, type);
      return c.json(await workItemSchema(client, project, type, defaults));
    },
  )

  // Live discovery for the setup screens. Each spends the connection's
  // credential on a remote call and returns that system's answer, error text
  // included, so it is held to the same rights as editing the connection.
  .get("/source-connections/:slug/discover/projects", requireAdmin, async (c) =>
    c.json(
      await probe(async () => {
        const { client } = await adoClientFor(c, c.req.param("slug")!);
        const found = await client.listProjects();
        return { projects: found.map((p) => ({ key: p.name, name: p.name })) };
      }),
    ),
  )

  .get("/source-connections/:slug/discover/wikis", requireAdmin, async (c) =>
    c.json(
      await probe(async () => {
        const { client } = await adoClientFor(c, c.req.param("slug")!);
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

  .get("/source-connections/:slug/discover/repos", requireAdmin, async (c) =>
    c.json(
      await probe(async () => {
        const project = c.req.query("project");
        if (!project) throw new Error("project is required");
        const slug = c.req.param("slug")!;
        const { client } = await adoClientFor(c, slug);
        const found = await client.listRepos(project);
        const userId = await callerUserId(c);
        const repos = found.map((r) => ({
          name: r.name,
          url: r.remoteUrl ?? r.webUrl ?? "",
          default_branch: (r.defaultBranch ?? "").replace(/^refs\/heads\//, ""),
        }));
        let next = 0;
        const worker = async () => {
          while (next < repos.length) {
            const repo = repos[next++];
            if (!repo.url) continue;
            repo.default_branch = await releaseBranch(
              repo.url,
              repo.default_branch,
              await connectionToken(slug, repo.url, userId).catch(
                () => undefined,
              ),
            );
          }
        };
        await Promise.all(Array.from({ length: DISCOVER_PROBES }, worker));
        return { repos };
      }),
    ),
  );
