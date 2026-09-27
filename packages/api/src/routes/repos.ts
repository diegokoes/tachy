import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  assertGlobalAdmin,
  badInput,
  getProductIdBySlug,
  getCustomerIdBySlug,
  getRepoBySlug,
  enqueueRun,
  linkRepo,
  listRepos,
  deleteRepo,
  repoScope,
  sourceProjectScope,
  sql,
  type EntryScope,
} from "@tachy/core";
import {
  assertScopeEditor,
  callerScope,
  callerUserId,
  requireCaller,
} from "../authz";
import type { Context } from "hono";

const linkSchema = z.object({
  slug: z.string().min(1),
  url: z.string().min(1),
  product: z.string().optional(),
  source: z.string().optional(),
  source_project_id: z.string().nullable().optional(),
  component: z.string().nullable().optional(),
  customer: z.string().nullable().optional(),
  branch: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

/** Linking a project's repos one form at a time does not scale past a handful:
 *  an Azure DevOps project routinely holds fifty. Authorization is checked once
 *  for the project everything lands in, then each repo is linked through the
 *  same linkRepo as the single-repo route, so one bad row cannot fail the rest. */
const bulkLinkSchema = z.object({
  source_project_id: z.string(),
  repos: z
    .array(
      z.object({
        slug: z.string().min(1),
        url: z.string().min(1),
        branch: z.string().optional(),
        component: z.string().nullable().optional(),
        customer: z.string().nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
});

/**
 * Where a repo lands, and — on the slug-keyed upsert — where it currently is:
 * without the second check a team admin could re-point another team's repo.
 */
async function assertCanWriteRepo(
  c: Context,
  target: { productSlug?: string; sourceProjectId?: string | null },
  slug?: string,
): Promise<void> {
  const scopes: EntryScope[] = [];
  if (target.sourceProjectId)
    scopes.push(await sourceProjectScope(target.sourceProjectId));
  else if (target.productSlug)
    scopes.push({ productId: await getProductIdBySlug(target.productSlug) });
  if (slug) {
    const [existing] = await sql`select slug from repos where slug = ${slug}`;
    if (existing) scopes.push(await repoScope(slug));
  }
  // An unscoped repo belongs to nobody in particular, so it stays admin-only.
  if (!scopes.length) return assertGlobalAdmin(await requireCaller(c));
  for (const scope of scopes) await assertScopeEditor(c, scope);
}

export const repos = new Hono()

  .get("/", async (c) => {
    const productSlug = c.req.query("product_slug");
    return c.json({
      repos: await listRepos({
        productId: productSlug
          ? await getProductIdBySlug(productSlug)
          : undefined,
        sourceProjectId: c.req.query("source_project_id") || undefined,
        customerId: c.req.query("customer")
          ? await getCustomerIdBySlug(c.req.query("customer")!)
          : undefined,
      }),
    });
  })

  .put("/", zValidator("json", linkSchema), async (c) => {
    const body = c.req.valid("json");
    await assertCanWriteRepo(
      c,
      { productSlug: body.product, sourceProjectId: body.source_project_id },
      body.slug,
    );
    const row = await linkRepo({
      slug: body.slug,
      url: body.url,
      productSlug: body.product,
      sourceSlug: body.source,
      sourceProjectId: body.source_project_id,
      componentSlug: body.component,
      customerSlug: body.customer,
      defaultBranch: body.branch,
      config: body.config,
    });
    return c.json({ ok: true, repo: row });
  })

  .put("/bulk", zValidator("json", bulkLinkSchema), async (c) => {
    const body = c.req.valid("json");
    await assertScopeEditor(
      c,
      await sourceProjectScope(body.source_project_id),
    );
    const results = [];
    for (const r of body.repos) {
      try {
        await linkRepo({
          slug: r.slug,
          url: r.url,
          sourceProjectId: body.source_project_id,
          componentSlug: r.component,
          customerSlug: r.customer,
          defaultBranch: r.branch,
        });
        results.push({ slug: r.slug, ok: true });
      } catch (e) {
        results.push({
          slug: r.slug,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return c.json({
      ok: results.every((r) => r.ok),
      linked: results.filter((r) => r.ok).length,
      results,
    });
  })

  .post("/:slug/reindex", async (c) => {
    const slug = c.req.param("slug");
    await assertCanWriteRepo(c, {}, slug);
    await getRepoBySlug(slug);
    const [busy] = await sql`
      select id from job_runs
      where kind = 'repo.reindex' and params->>'repo' = ${slug}
        and status in ('queued', 'running')
      limit 1
    `;
    if (busy)
      throw badInput(
        `repo '${slug}' is already being indexed (run ${busy.id})`,
      );
    const runId = await enqueueRun({
      kind: "repo.reindex",
      params: { repo: slug },
      trigger: "manual",
      requestedBy: await callerUserId(c),
    });
    return c.json({ ok: true, status: "queued", run_id: runId }, 202);
  })

  .delete("/:slug", async (c) => {
    const slug = c.req.param("slug");
    await assertCanWriteRepo(c, {}, slug);
    await deleteRepo(slug);
    return c.json({ ok: true });
  });
