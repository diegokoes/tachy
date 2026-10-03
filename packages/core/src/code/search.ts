import { releaseMinor } from "@tachy/contract";
import { sql } from "../infra/db";
import { badInput, notFound } from "../infra/errors";
import { embedQueryLiteral } from "../search/embeddings";
import {
  CANDIDATES,
  clampLimit,
  fusedCte,
  withSearchSession,
} from "../search/rank";
import { SEM_FLOOR, withRelevance } from "../search/relevance";
import { getRepoBySlug, getRepoLine } from "./repos";
import { readBlob, readFileAt, resolveRef } from "./git";
import { resolveVersion } from "./versions";

export interface CodeSearchOptions {
  repoSlug?: string;
  productId?: string;
  componentId?: string;
  sourceProjectId?: string;
  customerId?: string;
  /**
   * With a customer, also search the repos belonging to no customer - their
   * addon sits on shared product code, and the answer is as often in one as the
   * other. Set false for only what is theirs.
   */
  includeShared?: boolean;
  /** A tracked branch to search instead of each repo's default line. */
  line?: string;
  /**
   * A release version: each repo is searched on its tracked line for that
   * minor, and on its default line when it tracks none.
   */
  version?: string;
  pathPrefix?: string;
  limit?: number;
  /** Pre-embedded query, so a caller searching two surfaces embeds once. */
  queryVector?: string;
}

const GRADE_ORDER: Record<string, number> = { strong: 0, good: 1, weak: 2 };

export async function searchCode(query: string, opts: CodeSearchOptions = {}) {
  if (!query.trim()) return [];
  const limit = clampLimit(opts.limit, 8);
  const minor = opts.version ? releaseMinor(opts.version) : null;
  if (opts.version && !minor)
    throw badInput(
      `'${opts.version}' is not a version; expected major.minor or major.minor.patch`,
    );
  const qvec = opts.queryVector ?? (await embedQueryLiteral(query));

  // `like` treats % and _ as wildcards; a path prefix is a literal.
  const escapedPrefix = opts.pathPrefix?.replace(/([%_\\])/g, "\\$1");
  const prefix = escapedPrefix
    ? sql`and f.path like ${escapedPrefix + "%"}`
    : sql``;
  const lineMinor = sql`substring(l.version_label from '^v?(\\d+\\.\\d+)\\.')`;

  const lineChoice = opts.line
    ? sql`and l.ref = ${opts.line}`
    : minor
      ? sql`and (l.ref = r.default_branch or ${lineMinor} = ${minor})`
      : sql`and l.ref = r.default_branch`;

  const holds = sql`
    exists (
      select 1 from repo_line_files f
      join target_lines tl on tl.id = f.line_id
      where f.repo_id = c.repo_id and f.blob_sha = c.blob_sha ${prefix}
    )
  `;

  const rows = await withSearchSession(
    (tx) => tx`
    with
    target_lines as (
      select distinct on (r.id) l.id
      from repos r
      join repo_lines l on l.repo_id = r.id
      where coalesce(l.indexing_commit, l.indexed_commit) is not null
        ${lineChoice}
        ${opts.repoSlug ? sql`and r.slug = ${opts.repoSlug}` : sql``}
        ${opts.productId ? sql`and r.product_id = ${opts.productId}` : sql``}
        ${opts.componentId ? sql`and r.component_id = ${opts.componentId}` : sql``}
        ${opts.sourceProjectId ? sql`and r.source_project_id = ${opts.sourceProjectId}` : sql``}
        ${
          opts.customerId
            ? opts.includeShared === false
              ? sql`and r.customer_id = ${opts.customerId}`
              : sql`and (r.customer_id = ${opts.customerId} or r.customer_id is null)`
            : sql``
        }
      order by r.id, coalesce(${minor ? sql`${lineMinor} = ${minor}` : sql`false`}, false) desc
    ),
    vec as (
      select c.id,
             row_number() over (order by c.embedding <=> ${qvec}::vector) as rnk,
             1 - (c.embedding <=> ${qvec}::vector) as cos_sim
      from code_blob_chunks c
      where c.embedding is not null
        and 1 - (c.embedding <=> ${qvec}::vector) >= ${SEM_FLOOR}
        and ${holds}
      order by c.embedding <=> ${qvec}::vector
      limit ${CANDIDATES}
    ),
    -- Code has no tsvector; identifiers are what the trigram leg is for, so the
    -- lexical slot stays empty rather than pretending otherwise.
    lex as (select null::uuid as id, 0::bigint as rnk, 0::float as fts_rank where false),
    fuzzy as (
      select c.id,
             row_number() over (order by word_similarity(${query}, c.chunk_text) desc) as rnk,
             word_similarity(${query}, c.chunk_text) as trgm_sim
      from code_blob_chunks c
      where ${query} <% c.chunk_text and ${holds}
      order by word_similarity(${query}, c.chunk_text) desc
      limit ${CANDIDATES}
    ),
    ${fusedCte()}
    select r.slug as repo_slug, comp.slug as component_slug, cu.slug as customer_slug,
           l.ref as line, l.version_label, l.index_status,
           f.path, f.lang, c.start_line, c.end_line,
           left(c.chunk_text, 1200) as snippet,
           fu.cos_sim, fu.fts_rank, fu.trgm_sim, fu.rrf,
           coalesce(l.indexing_commit, l.indexed_commit) as commit,
           l.last_indexed_at,
           extract(day from now() - l.last_indexed_at)::int as indexed_days_ago
    from fused fu
    join code_blob_chunks c on c.id = fu.id
    join repos r on r.id = c.repo_id
    join lateral (
      select f.path, f.lang, f.line_id
      from repo_line_files f
      join target_lines tl on tl.id = f.line_id
      where f.repo_id = c.repo_id and f.blob_sha = c.blob_sha ${prefix}
      order by f.path
      limit 1
    ) f on true
    join repo_lines l on l.id = f.line_id
    left join components comp on comp.id = r.component_id
    left join customers cu on cu.id = r.customer_id
    order by fu.rrf desc, f.path, c.start_line
    limit ${limit}
  `,
  );
  // The page is cut by rank; within it, what is shown first should agree with
  // the grade it is shown with.
  return (rows as unknown as Parameters<typeof withRelevance>[0][])
    .map(withRelevance)
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) => GRADE_ORDER[a.r.grade] - GRADE_ORDER[b.r.grade] || a.i - b.i,
    )
    .map(({ r }) => r);
}

const MAX_LINES = 400;
const MAX_BYTES = 64 * 1024;

export interface ReadCodeOptions {
  startLine?: number;
  endLine?: number;
  /** A tracked line, or any branch or tag the clone has. Default line when absent. */
  ref?: string;
  /** A release version, read at its tag exactly as it shipped. */
  version?: string;
  /** Fetches content the clone does not hold yet, such as an old release. */
  token?: string;
}

async function contentFor(
  repoSlug: string,
  path: string,
  opts: ReadCodeOptions,
): Promise<{ content: string; ref: string; commit: string | null }> {
  if (opts.version) {
    const v = await resolveVersion(repoSlug, opts.version);
    if (!v.tag)
      throw notFound(
        `Repo '${repoSlug}' has no release tag for ${v.version}; read the '${v.line.ref}' line instead`,
      );
    return {
      content: await readFileAt(repoSlug, v.commit!, path, opts.token),
      ref: v.tag,
      commit: v.commit,
    };
  }

  const repo = await getRepoBySlug(repoSlug);
  const tracked = repo.lines.find(
    (l) => l.ref === (opts.ref ?? repo.default_branch),
  );
  if (!tracked) {
    const ref = opts.ref!;
    const commit =
      (await resolveRef(repoSlug, `refs/heads/${ref}`)) ??
      (await resolveRef(repoSlug, `refs/tags/${ref}`));
    if (!commit)
      throw notFound(
        `Repo '${repoSlug}' has no branch or tag '${ref}' fetched`,
      );
    return {
      content: await readFileAt(repoSlug, commit, path, opts.token),
      ref,
      commit,
    };
  }

  const line = await getRepoLine(repoSlug, tracked.ref);
  const commit = line.indexing_commit ?? line.indexed_commit;
  if (!commit)
    throw badInput(
      `Repo '${repoSlug}' line '${line.ref}' has not been indexed yet`,
    );
  // The blob, not commit:path: mid-index, a line holds files from two
  // commits, and a search hit must open the content that was found.
  const [file] = await sql`
    select blob_sha from repo_line_files where line_id = ${line.id} and path = ${path}
  `;
  return {
    content: file
      ? await readBlob(repoSlug, file.blob_sha, opts.token)
      : await readFileAt(repoSlug, commit, path, opts.token),
    ref: line.ref,
    commit,
  };
}

export async function readCodeFile(
  repoSlug: string,
  path: string,
  opts: ReadCodeOptions = {},
) {
  const { content, ref, commit } = await contentFor(repoSlug, path, opts);
  const lines = content.split("\n");

  const start = Math.max(opts.startLine ?? 1, 1);
  const requestedEnd = Math.min(
    opts.endLine ?? start + MAX_LINES - 1,
    lines.length,
  );
  const end = Math.min(requestedEnd, start + MAX_LINES - 1);

  let out: string[] = [];
  let bytes = 0;
  let byteTruncated = false;
  for (let n = start; n <= end; n++) {
    const line = `${n}\t${lines[n - 1]}`;
    bytes += line.length + 1;
    if (bytes > MAX_BYTES) {
      byteTruncated = true;
      break;
    }
    out.push(line);
  }
  return {
    repo: repoSlug,
    path,
    ref,
    commit,
    total_lines: lines.length,
    start_line: start,
    end_line: start + out.length - 1,
    truncated: byteTruncated || end < requestedEnd || end < lines.length,
    content: out.join("\n"),
  };
}
