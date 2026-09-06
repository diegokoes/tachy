import { z } from "zod";
import {
  resolveCurrentUserId,
  recordRun,
  getCustomerIdBySlug,
  listRepos,
  searchCode,
  readCodeFile,
  resolveComponentStrict,
  badInput,
} from "@tachy/core";
import { tool } from "../server";
import { GRADE_NOTE, out, outScrubbed, searchOut } from "../results";
import { resolveScopeIds } from "../context";

/**
 * Linked repositories: searching indexed code, and reading a file out of it.
 */

tool(
  "list_repos",
  {
    description:
      "List linked git repositories available for code search, with the component each one implements, the customer it belongs to (null = shared product code), and its index freshness. index_status 'error' or a stale last_indexed_at means results may not reflect current code — say so when citing. Filter by product or component to find the repo that actually holds the area you are asking about, or by customer to find their addon.",
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
      })),
    );
  },
);

tool(
  "search_code",
  {
    description: `Hybrid (semantic + trigram) search over the indexed code of linked repositories. Returns the top-matching chunks with path, line range, and the commit they were indexed at. Search with symptom terms, symbol names, or error strings; then use read_code_file to read narrowly around a hit. Results reflect the indexed commit, not necessarily the latest code — always cite path:start-end @ commit and mention index age when advising. ${GRADE_NOTE}`,
    inputSchema: {
      query: z.string(),
      repo: z.string().optional().describe("Repo slug from list_repos"),
      product_slug: z.string().optional(),
      component: z
        .string()
        .optional()
        .describe(
          "Component slug — searches only the repos that implement it. Needs product_slug.",
        ),
      customer: z
        .string()
        .optional()
        .describe(
          "Customer slug — searches their addon repos AND the shared ones, since an addon sits on shared product code. Another customer's addon is excluded.",
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
    path_prefix,
    limit,
  }) => {
    const { productId } = await resolveScopeIds({ product_slug });
    if (component && !productId)
      throw badInput("component needs product_slug to resolve against");
    const rows = await searchCode(query, {
      repoSlug: repo,
      productId,
      componentId:
        productId && component
          ? (await resolveComponentStrict(productId, component)).id
          : undefined,
      customerId: customer ? await getCustomerIdBySlug(customer) : undefined,
      pathPrefix: path_prefix,
      limit,
    });
    await recordRun({
      userId: await resolveCurrentUserId(),
      mode: "code",
      meta: { query, repo: repo ?? null, hits: rows.length },
    });
    return searchOut(
      rows.map((r: any) => ({
        repo: r.repo_slug,
        component: r.component_slug,
        customer: r.customer_slug,
        path: r.path,
        lines: `${r.start_line}-${r.end_line}`,
        lang: r.lang,
        relevance: r.relevance,
        grade: r.grade,
        snippet: r.snippet,
        indexed_commit: r.indexed_commit,
        indexed_days_ago: r.indexed_days_ago,
      })),
      "search_code",
    );
  },
);

tool(
  "read_code_file",
  {
    description:
      "Read a bounded slice of a file from a linked repo at its indexed commit (max 400 lines per call). Use after search_code to see the surrounding context of a hit. Never paste whole files into answers or saved knowledge entries — quote only the relevant lines.",
    inputSchema: {
      repo: z.string(),
      path: z.string(),
      start_line: z.number().int().positive().optional(),
      end_line: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ repo, path, start_line, end_line }) => {
    return outScrubbed(
      await readCodeFile(repo, path, {
        startLine: start_line,
        endLine: end_line,
      }),
    );
  },
);
