import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { assertGlobalAdmin, type EntryScope } from "@tachy/core/access";
import { badInput, notFound, sql, errorText } from "@tachy/core/infra";
import { getProductIdBySlug, getCustomerIdBySlug } from "@tachy/core/catalog";
import {
  getRepoBySlug,
  linkRepo,
  listRepos,
  deleteRepo,
  repoScope,
  connectionToken,
  listRemoteRefs,
  previewIndex,
  fileIconPath,
  activeReindexes,
  repoToken,
  readCodeFile,
} from "@tachy/core/code";
import {
  globalRedactionEnabled,
  scrubDeep,
  TokenMap,
} from "@tachy/core/compliance";
import { enqueueRun, inFlightRun } from "@tachy/core/jobs";
import { sourceProjectScope, getSourceProject } from "@tachy/core/sources";
import { RELEASE_TAG_RE } from "@tachy/core";
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
  lines: z.array(z.string().min(1)).max(20).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const reindexSchema = z.object({ line: z.string().min(1).optional() });
const fileSchema = z.object({
  path: z.string().min(1),
  start: z.coerce.number().int().positive().optional(),
  end: z.coerce.number().int().positive().optional(),
  ref: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
});
const previewSchema = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
});

/** Newest release first; branches keep the remote's order. */
const byReleaseDesc = (a: string, b: string) => {
  const partsA = RELEASE_TAG_RE.exec(a)!.slice(1).map(Number);
  const partsB = RELEASE_TAG_RE.exec(b)!.slice(1).map(Number);
  return (
    partsB[0] - partsA[0] || partsB[1] - partsA[1] || partsB[2] - partsA[2]
  );
};

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

/**
 * Linking a project's repos one form at a time does not scale: an Azure DevOps
 * project can hold dozens. Authorization is checked once for the project
 * everything lands in, then each repo goes through the same `linkRepo` as the
 * single-repo route, so one bad row cannot fail the rest.
 */
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
 * Where a repo lands, and - on the slug-keyed upsert - where it currently is:
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
    const [repos, runs] = await Promise.all([
      listRepos({
        productId: productSlug
          ? await getProductIdBySlug(productSlug)
          : undefined,
        sourceProjectId: c.req.query("source_project_id") || undefined,
        customerId: c.req.query("customer")
          ? await getCustomerIdBySlug(c.req.query("customer")!)
          : undefined,
      }),
      activeReindexes(),
    ]);
    return c.json({
      repos: repos.map((r) => ({ ...r, active_run: runs.get(r.slug) ?? null })),
    });
  })

  // A file type's icon, by the id a preview names; only the theme's own ids
  // resolve.
  .get("/file-icons/:file", async (c) => {
    const file = c.req.param("file");
    const path = file.endsWith(".svg") ? fileIconPath(file.slice(0, -4)) : null;
    if (!path) throw notFound(`No file icon '${file}'`);
    return c.body(new Uint8Array(await readFile(path)), 200, {
      "Content-Type": "image/svg+xml",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'",
      "Cache-Control": "private, max-age=31536000, immutable",
    });
  })

  // Every linked repo, as one parent run fanning out a reindex per repo.
  .post("/reindex", async (c) => {
    await assertGlobalAdmin(await requireCaller(c));
    const params = { scope: "all" };
    const runId = await enqueueRun({
      kind: "repos.refresh",
      params,
      trigger: "manual",
      requestedBy: await callerUserId(c),
    });
    return c.json(
      runId
        ? { ok: true, status: "queued", run_id: runId }
        : {
            ok: true,
            status: "in_flight",
            run_id: await inFlightRun("repos.refresh", params),
          },
      202,
    );
  })

  .put("/", zValidator("json", linkSchema), async (c) => {
    const body = c.req.valid("json");
    await assertCanWriteRepo(
      c,
      { productSlug: body.product, sourceProjectId: body.source_project_id },
      body.slug,
    );
    const linked = await linkRepo({
      slug: body.slug,
      url: body.url,
      productSlug: body.product,
      sourceSlug: body.source,
      sourceProjectId: body.source_project_id,
      componentSlug: body.component,
      customerSlug: body.customer,
      defaultBranch: body.branch,
      lines: body.lines,
      config: body.config,
    });
    return c.json({ ok: true, repo: linked });
  })

  // The branches and release tags a remote offers, for the link form. Same
  // authorisation as linking there, since it runs git against the URL with the
  // project's connection token.
  .get("/refs", async (c) => {
    const url = c.req.query("url") ?? "";
    const sourceProjectId = c.req.query("source_project_id") || undefined;
    await assertCanWriteRepo(c, {
      sourceProjectId,
      productSlug: c.req.query("product") || undefined,
    });
    return c.json(
      await probe(async () => {
        const sourceSlug = sourceProjectId
          ? (await getSourceProject(sourceProjectId)).source_slug
          : null;
        const refs = await listRemoteRefs(
          url,
          await connectionToken(sourceSlug, url, await callerUserId(c)),
        );
        return {
          branches: refs.filter((r) => r.kind === "branch").map((r) => r.name),
          releases: refs
            .filter((r) => r.kind === "tag" && RELEASE_TAG_RE.test(r.name))
            .map((r) => r.name)
            .sort(byReleaseDesc),
        };
      }),
    );
  })

  .put("/bulk", zValidator("json", bulkLinkSchema), async (c) => {
    const body = c.req.valid("json");
    await assertScopeEditor(
      c,
      await sourceProjectScope(body.source_project_id),
    );
    const results = [];
    for (const repo of body.repos) {
      try {
        await linkRepo({
          slug: repo.slug,
          url: repo.url,
          sourceProjectId: body.source_project_id,
          componentSlug: repo.component,
          customerSlug: repo.customer,
          defaultBranch: repo.branch,
        });
        results.push({ slug: repo.slug, ok: true });
      } catch (e) {
        results.push({
          slug: repo.slug,
          ok: false,
          error: errorText(e),
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
    const body = reindexSchema.parse(await c.req.json().catch(() => ({})));
    const repo = await getRepoBySlug(slug);
    if (body.line && !repo.lines.some((l) => l.ref === body.line))
      throw badInput(`repo '${slug}' does not track '${body.line}'`);
    const params = { repo: slug, ...(body.line ? { line: body.line } : {}) };
    const runId = await enqueueRun({
      kind: "repo.reindex",
      params,
      trigger: "manual",
      requestedBy: await callerUserId(c),
    });
    if (runId)
      return c.json({ ok: true, status: "queued", run_id: runId }, 202);
    return c.json(
      {
        ok: true,
        status: "in_flight",
        run_id: await inFlightRun("repo.reindex", params),
      },
      202,
    );
  })

  // What the default line would index under a proposed config; nothing is
  // embedded.
  .post("/:slug/preview", zValidator("json", previewSchema), async (c) => {
    const slug = c.req.param("slug");
    await assertCanWriteRepo(c, {}, slug);
    const body = c.req.valid("json");
    return c.json(
      await probe(async () =>
        previewIndex(slug, {
          config: body.config,
          token: await repoToken(slug, await callerUserId(c)),
        }),
      ),
    );
  })

  // The lines a walkthrough step points at, redacted as the agent's own read
  // of them is, so the panel shows what the answer was written from.
  .get("/:slug/file", zValidator("query", fileSchema), async (c) => {
    const slug = c.req.param("slug");
    const query = c.req.valid("query");
    const file = await readCodeFile(slug, query.path, {
      startLine: query.start,
      endLine: query.end,
      ref: query.ref,
      version: query.version,
      token: await repoToken(slug, await requireCaller(c)),
    });
    return c.json(
      globalRedactionEnabled() ? scrubDeep(file, new TokenMap()) : file,
    );
  })

  .delete("/:slug", async (c) => {
    const slug = c.req.param("slug");
    await assertCanWriteRepo(c, {}, slug);
    await deleteRepo(slug);
    return c.json({ ok: true });
  });
