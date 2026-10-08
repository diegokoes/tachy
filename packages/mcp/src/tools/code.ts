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
  reposInProject,
  getRepoBySlug,
  searchCode,
  readCodeFile,
  listCodeDir,
  codeChangesBetween,
  codeDiff,
  codeReleasesContaining,
  repoToken,
} from "@tachy/core/code";
import { badInput } from "@tachy/core/infra";
import { tool } from "../server";
import { GRADE_NOTE, out, outScrubbed, searchOut } from "../results";
import { resolveScopeIds } from "../context";

const PROJECT_FIELD =
  "A source project by key or name, as list_repos `project_key` gives it or as a /code scope names it: every repo linked under it.";

/**
 * The repos that `repo`, `repos` and `project` name together, or undefined
 * when none of them is given. An unknown slug is refused rather than searched
 * as an empty set, which would read as the code having nothing on it.
 */
async function scopedRepoSlugs(scope: {
  repo?: string;
  repos?: string[];
  project?: string;
}): Promise<string[] | undefined> {
  const named = [...(scope.repo ? [scope.repo] : []), ...(scope.repos ?? [])];
  for (const slug of named) await getRepoBySlug(slug);
  const inProject = scope.project ? await reposInProject(scope.project) : [];
  const slugs = new Set([...named, ...inProject.map((r) => r.slug)]);
  return slugs.size ? [...slugs] : undefined;
}

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
      project: z.string().optional().describe(PROJECT_FIELD),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ product_slug, component, customer, project }) => {
    const { productId } = await resolveScopeIds({ product_slug });
    const inProject = await scopedRepoSlugs({ project });
    const listed = await listRepos({
      productId,
      componentId:
        productId && component
          ? (await resolveComponentStrict(productId, component)).id
          : undefined,
      customerId: customer ? await getCustomerIdBySlug(customer) : undefined,
    });
    const rows = inProject
      ? listed.filter((r) => inProject.includes(r.slug))
      : listed;
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
      repos: z
        .array(z.string())
        .optional()
        .describe(
          "Several repo slugs searched as one, for a question that crosses repos. Each hit's `repo` says where it came from.",
        ),
      project: z.string().optional().describe(PROJECT_FIELD),
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
    repos,
    project,
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
    const repoSlugs = await scopedRepoSlugs({ repo, repos, project });
    const hits = await searchCode(query, {
      repoSlugs,
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
      meta: {
        query,
        repo: repoSlugs?.join(",") ?? null,
        hits: hits.length,
      },
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
  async ({ repo, from_version, to_version, path, limit }) => {
    const changes = await codeChangesBetween(repo, from_version, to_version, {
      path,
      limit,
    });
    return out(
      changes.commits.length ? { ...changes, next: CHANGES_NEXT } : changes,
    );
  },
);

const CHANGES_NEXT =
  "For one of these commits: code_diff with its sha shows what it changed, and code_releases_containing names the first release it shipped in.";

const REVISION_FIELD =
  "A release (1.51.32), a branch or tag name, or a commit sha.";

tool(
  "code_diff",
  {
    description:
      "What one commit changed in a linked repo (`commit`), or what differs between two revisions (`from` and `to`): the changed files and the patch. Use it to read what a fix actually did, or to compare two branches or releases. A diff over more than 40 files returns the file list with patch: null - pass `path` to read one file or directory of it. truncated: true means the patch was cut; narrow with `path`. Quote only the hunks that matter, cited as path @ commit.",
    inputSchema: {
      repo: z.string(),
      commit: z
        .string()
        .optional()
        .describe(
          "A commit sha, full or abbreviated, diffed against its parent. Instead of from/to.",
        ),
      from: z.string().optional().describe(REVISION_FIELD),
      to: z.string().optional().describe(REVISION_FIELD),
      path: z
        .string()
        .optional()
        .describe("Only changes to this file or directory."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ repo, commit, from, to, path }) =>
    outScrubbed(
      await codeDiff(repo, {
        commit,
        from,
        to,
        path,
        token: await repoToken(repo, await resolveCurrentUserId()),
      }),
    ),
);

tool(
  "code_releases_containing",
  {
    description:
      "Which releases of a linked repo contain a commit: the first one overall, the first on each minor, and whether each tracked line holds it. This answers 'which version fixes this' once the fixing commit is known, from code_changes_between or code_diff. A search hit's indexed_commit is where the index stands, not a fix. A customer has the fix when their version is at or past the first release on their minor. first_release: null means it has not shipped in any release.",
    inputSchema: {
      repo: z.string(),
      commit: z.string().describe("A commit sha, full or abbreviated."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ repo, commit }) => out(await codeReleasesContaining(repo, commit)),
);

tool(
  "list_code_tree",
  {
    description:
      "The entries of one directory in a linked repo, directories first: for finding where things live when a search has no term to start from, or for describing how a repo is laid out. One level per call; pass an entry's path to go deeper. Read files with read_code_file.",
    inputSchema: {
      repo: z.string(),
      path: z
        .string()
        .optional()
        .describe("Directory to list. The repo root when absent."),
      version: z
        .string()
        .optional()
        .describe("A release (1.51.32): the tree as that release shipped."),
      ref: z
        .string()
        .optional()
        .describe(
          "A tracked line from list_repos `lines`, or any branch or tag name.",
        ),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ repo, path, version, ref }) =>
    out(await listCodeDir(repo, path ?? "", { version, ref })),
);

const MAX_WALKTHROUGH_STEPS = 8;
const MAX_STEP_LINES = 60;

tool(
  "show_code_walkthrough",
  {
    description: `Show the user a walkthrough panel: ordered steps through a flow, each one a range of real code with the deciding lines lit and a short note beside it. You send only where the code is; the app reads the lines itself, so never put code in a note. Use it when asked to walk through, show or visualise how something works, after you have read the ranges with read_code_file. Steps go in execution order, at most ${MAX_WALKTHROUGH_STEPS}, each the narrowest range that shows its point (at most ${MAX_STEP_LINES} lines). Afterwards say one line; do not repeat the code or the notes in text.`,
    inputSchema: {
      title: z.string().describe("What is being walked through, a few words."),
      steps: z
        .array(
          z.object({
            label: z
              .string()
              .describe("The step's name on the rail, one to three words."),
            repo: z.string(),
            path: z.string(),
            start_line: z.number().int().positive(),
            end_line: z.number().int().positive(),
            version: z
              .string()
              .optional()
              .describe(
                "As read_code_file: the release the range was read at.",
              ),
            ref: z
              .string()
              .optional()
              .describe("As read_code_file: the line the range was read on."),
            highlight: z
              .array(z.tuple([z.number().int(), z.number().int()]))
              .optional()
              .describe(
                "Line ranges [first, last] inside the step that decide the outcome. A few lines, not the whole step.",
              ),
            note: z
              .string()
              .describe(
                "One or two sentences: what happens here and why it matters to the question.",
              ),
          }),
        )
        .min(1)
        .max(MAX_WALKTHROUGH_STEPS),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ steps }) => {
    const userId = await resolveCurrentUserId();
    const shown = [];
    for (const step of steps) {
      if (step.end_line - step.start_line >= MAX_STEP_LINES)
        throw badInput(
          `step '${step.label}' spans more than ${MAX_STEP_LINES} lines; split it or narrow it`,
        );
      const read = await readCodeFile(step.repo, step.path, {
        startLine: step.start_line,
        endLine: step.end_line,
        version: step.version,
        ref: step.ref,
        token: await repoToken(step.repo, userId),
      });
      if (read.end_line < read.start_line)
        throw badInput(
          `step '${step.label}': ${step.path} has ${read.total_lines} lines`,
        );
      shown.push({
        path: read.path,
        ref: read.ref,
        commit: read.commit,
        start_line: read.start_line,
        end_line: read.end_line,
      });
    }
    return out({ shown, note: WALKTHROUGH_SHOWN });
  },
);

const WALKTHROUGH_SHOWN =
  "The panel is on screen with these ranges. Say one line about it; the code and the notes are already there.";
