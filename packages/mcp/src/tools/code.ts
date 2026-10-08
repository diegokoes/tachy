/**
 * Linked repositories: searching indexed code, and reading a file out of it.
 */
import { z } from "zod";
import { resolveCurrentUserId } from "@tachy/core/access";
import { recordRun } from "@tachy/core/analytics";
import {
  getCustomerIdBySlug,
  resolveComponentStrict,
} from "@tachy/core/catalog";
import {
  listRepos,
  searchCode,
  readCodeFile,
  codeChangesBetween,
  repoToken,
} from "@tachy/core/code";
import { badInput } from "@tachy/core/infra";
import { tool } from "../server";
import { GRADE_NOTE, out, outScrubbed, searchOut } from "../results";
import { resolveScopeIds } from "../context";

tool(
  "list_repos",
  {
    description:
      "List linked git repositories available for code search, with the component each one implements, the customer it belongs to (null = shared product code), and its index freshness. index_status 'error' or a stale last_indexed_at means results may not reflect current code - say so when citing. `lines` are the branches indexed, the default first; each line's version_label is the newest release on it, so an older line (legacy/master-1-50 at v1.50.49) is where a customer on that minor should be searched. Filter by product or component to find the repo that actually holds the area you are asking about, or by customer to find their addon.",
    inputSchema: {
      product_slug: z.string().optional(),
      component: z.string().optional(),
      customer: z
        .string()
        .optional()
        .describe(
          "Customer slug from list_customers. Returns their own addon repos AND the shared ones, because an addon sits on shared product code.",
        ),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ product_slug, component, customer }) => {
    const { productId } = await resolveScopeIds({ product_slug });
    const rows = await listRepos({
      productId,
      componentId:
        productId && component
          ? (await resolveComponentStrict(productId, component)).id
          : undefined,
      customerId: customer ? await getCustomerIdBySlug(customer) : undefined,
    });
    return out(
      rows.map((r) => ({
        slug: r.slug,
        url: r.url,
        product_slug: r.product_slug,
        component: r.component_slug,
        customer: r.customer_slug,
        project_key: r.project_key,
        default_branch: r.default_branch,
        index_status: r.index_status,
        indexed_commit: r.indexed_commit,
        last_indexed_at: r.last_indexed_at,
        file_count: r.file_count,
        chunk_count: r.chunk_count,
        ...(r.index_error ? { index_error: r.index_error } : {}),
        lines: r.lines.map((l) => ({
          ref: l.ref,
          version_label: l.version_label,
          index_status: l.index_status,
          last_indexed_at: l.last_indexed_at,
        })),
      })),
    );
  },
);

tool(
  "search_code",
  {
    description: `Hybrid (semantic + trigram) search over the indexed code of linked repositories. Returns the top-matching chunks with path, line range, the line (branch) and the commit they were indexed at. Search with symptom terms, symbol names, or error strings; then use read_code_file to read narrowly around a hit. Results reflect the indexed commit, not necessarily the latest code - always cite path:start-end @ commit and mention index age when advising; a hit with partial: true comes from an index still being written or interrupted. ${GRADE_NOTE}`,
    inputSchema: {
      query: z.string(),
      repo: z.string().optional().describe("Repo slug from list_repos"),
      product_slug: z.string().optional(),
      component: z
        .string()
        .optional()
        .describe(
          "Component slug - searches only the repos that implement it. Needs product_slug.",
        ),
      customer: z
        .string()
        .optional()
        .describe(
          "Customer slug - searches their addon repos AND the shared ones, since an addon sits on shared product code. Another customer's addon is excluded.",
        ),
      version: z
        .string()
        .optional()
        .describe(
          "The customer's version (e.g. the ticket's observed_version, 1.50.20). Each repo is searched on its tracked line for that minor, and on its default line when it tracks none; each hit's `line` says which. For the code exactly as that release shipped, read_code_file with version.",
        ),
      line: z
        .string()
        .optional()
        .describe(
          "A tracked branch from list_repos `lines`, instead of each repo's default line.",
        ),
      path_prefix: z.string().optional(),
      limit: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({
    query,
    repo,
    product_slug,
    component,
    customer,
    version,
    line,
    path_prefix,
    limit,
  }) => {
    const { productId } = await resolveScopeIds({ product_slug });
    if (component && !productId)
      throw badInput("component needs product_slug to resolve against");
    const hits = await searchCode(query, {
      repoSlug: repo,
      productId,
      componentId:
        productId && component
          ? (await resolveComponentStrict(productId, component)).id
          : undefined,
      customerId: customer ? await getCustomerIdBySlug(customer) : undefined,
      version,
      line,
      pathPrefix: path_prefix,
      limit,
    });
    await recordRun({
      userId: await resolveCurrentUserId(),
      mode: "code",
      meta: { query, repo: repo ?? null, hits: hits.length },
    });
    return searchOut(
      hits.map((r: any) => ({
        repo: r.repo_slug,
        component: r.component_slug,
        customer: r.customer_slug,
        line: r.line,
        version_label: r.version_label,
        path: r.path,
        lines: `${r.start_line}-${r.end_line}`,
        lang: r.lang,
        relevance: r.relevance,
        grade: r.grade,
        snippet: r.snippet,
        indexed_commit: r.commit,
        indexed_days_ago: r.indexed_days_ago,
        ...(r.index_status !== "ready" ? { partial: true } : {}),
      })),
      "search_code",
    );
  },
);

tool(
  "read_code_file",
  {
    description:
      "Read a bounded slice of a file from a linked repo (max 400 lines per call): by default at its default line's index, so a search_code hit opens exactly as found. Use after search_code to see the surrounding context of a hit. Never paste whole files into answers or saved knowledge entries - quote only the relevant lines.",
    inputSchema: {
      repo: z.string(),
      path: z.string(),
      version: z
        .string()
        .optional()
        .describe(
          "A release (1.51.32): the file exactly as that release shipped, from its tag, whether or not any line tracks it. Use the customer's version when judging whether their install has a bug or a fix.",
        ),
      ref: z
        .string()
        .optional()
        .describe(
          "A tracked line from list_repos `lines`, or any branch or tag name.",
        ),
      start_line: z.number().int().positive().optional(),
      end_line: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ repo, path, version, ref, start_line, end_line }) => {
    return outScrubbed(
      await readCodeFile(repo, path, {
        startLine: start_line,
        endLine: end_line,
        version,
        ref,
        token: await repoToken(repo, await resolveCurrentUserId()),
      }),
    );
  },
);

tool(
  "code_changes_between",
  {
    description:
      "The commits between two releases of a linked repo, optionally under one path, and the archived work items their messages reference (#123) with the fixed_version their knowledge entries record. From the customer's version to a later one, it answers what shipped since and whether a fix is in it. Without to_version, it runs to the head of the line from_version belongs to.",
    inputSchema: {
      repo: z.string(),
      from_version: z
        .string()
        .describe("Release to start after, e.g. the customer's 1.51.32."),
      to_version: z.string().optional(),
      path: z
        .string()
        .optional()
        .describe("Only commits touching this file or directory."),
      limit: z.number().int().positive().max(500).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ repo, from_version, to_version, path, limit }) =>
    out(
      await codeChangesBetween(repo, from_version, to_version, { path, limit }),
    ),
);
