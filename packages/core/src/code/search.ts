import { releaseMinor } from "@tachy/contract";
import { sql } from "../infra/db";
import { badInput, notFound } from "../infra/errors";
import { embedQueryLiteral } from "../search/embeddings";
import {
  CANDIDATES,
  clampLimit,
  fusedCte,
  RRF_K,
  withSearchSession,
} from "../search/rank";
import { currentVector } from "../search/backfill";
import { CODE_SEM_FLOOR, withRelevance } from "../search/relevance";
import { getRepoBySlug, getRepoLine } from "./repos";
import { listDir, readBlob, readFileAt, resolveRef } from "./git";
import { resolveVersion } from "./versions";

export interface CodeSearchOptions {
  repoSlug?: string;
  /** Several repos at once; with `repoSlug`, both are searched. */
  repoSlugs?: string[];
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

/**
 * What defining the thing asked for is worth: as much as coming first in a leg
 * of its own. Rank fusion rewards agreement between legs, and a definition
 * often shows in one leg only, since a component's file never says its own
 * name, while every file that mentions it shows in two.
 */
const DEFINES_BOOST = 1 / (RRF_K + 1);

/**
 * Chunks one file may put among a leg's candidates, and on a page. A long
 * document that repeats a name otherwise fills both by itself.
 */
const PER_FILE = 2;

/**
 * How far past its candidates the vector leg reads to find them in enough
 * files.
 */
const NEAREST = 4;

/**
 * Weights of the lexemes in search_tsv, D to A: the body, then the names a
 * chunk defines. A body has to repeat a name dozens of times to weigh what
 * one definition does.
 */
const LEX_WEIGHTS = "{0.02, 0.2, 0.4, 1.0}";

export async function searchCode(query: string, opts: CodeSearchOptions = {}) {
  if (!query.trim()) return [];
  const limit = clampLimit(opts.limit, 8);
  const minor = opts.version ? releaseMinor(opts.version) : null;
  if (opts.version && !minor)
    throw badInput(
      `'${opts.version}' is not a version; expected major.minor or major.minor.patch`,
    );
  const qvec = opts.queryVector ?? (await embedQueryLiteral(query));
  const repoSlugs = [
    ...(opts.repoSlug ? [opts.repoSlug] : []),
    ...(opts.repoSlugs ?? []),
  ];

  // `like` treats % and _ as wildcards; a path prefix is a literal.
  const escapedPrefix = opts.pathPrefix?.replace(/([%_\\])/g, "\\$1");
  const prefix = escapedPrefix
    ? sql`and f.path like ${escapedPrefix + "%"}`
    : sql``;
  const lineMinor = sql`substring(l.version_label from '^v?(\\d+\\.\\d+)\\.')`;

  const versionLine = minor
    ? sql`and (l.ref = r.default_branch or ${lineMinor} = ${minor})`
    : sql`and l.ref = r.default_branch`;
  const lineChoice = opts.line ? sql`and l.ref = ${opts.line}` : versionLine;
  const ofCustomer = (id: string) =>
    opts.includeShared === false
      ? sql`and r.customer_id = ${id}`
      : sql`and (r.customer_id = ${id} or r.customer_id is null)`;

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
        ${repoSlugs.length ? sql`and r.slug = any(${repoSlugs})` : sql``}
        ${opts.productId ? sql`and r.product_id = ${opts.productId}` : sql``}
        ${opts.componentId ? sql`and r.component_id = ${opts.componentId}` : sql``}
        ${opts.sourceProjectId ? sql`and r.source_project_id = ${opts.sourceProjectId}` : sql``}
        ${opts.customerId ? ofCustomer(opts.customerId) : sql``}
      order by r.id, coalesce(${minor ? sql`${lineMinor} = ${minor}` : sql`false`}, false) desc
    ),
    -- In every leg a file contributes its best chunks only. A long document
    -- that repeats a name otherwise takes all the candidate places, and the
    -- file that defines the name never reaches the fusion.
    vec as (
      select id, row_number() over (order by dist, id) as rnk, 1 - dist as cos_sim
      from (
        select n.id, n.dist,
               row_number() over (partition by n.repo_id, n.blob_sha order by n.dist) as nth
        from (
          select c.id, c.repo_id, c.blob_sha, c.embedding <=> ${qvec}::vector as dist
          from code_blob_chunks c
          where c.embedding is not null and ${currentVector("c")}
            and 1 - (c.embedding <=> ${qvec}::vector) >= ${CODE_SEM_FLOOR}
            and ${holds}
          order by c.embedding <=> ${qvec}::vector
          limit ${CANDIDATES * NEAREST}
        ) n
      ) x
      where nth <= ${PER_FILE}
      order by dist, id
      limit ${CANDIDATES}
    ),
    -- Every word of the query, as a whole word or as part of an identifier.
    -- The second query is the same words against the symbols alone: the
    -- lexemes weighted A, which are the names a chunk defines.
    words as (
      select q, regexp_replace(q::text, $re$'( |$)$re$, $to$':A\\1$to$, 'g')::tsquery as defines
      from (select websearch_to_tsquery('simple', tachy_code_words(${query})) as q) x
    ),
    lex as (
      select id, row_number() over (order by score desc, id) as rnk, score as fts_rank
      from (
        select c.id, k.score,
               row_number() over (
                 partition by c.repo_id, c.blob_sha order by k.score desc, c.ordinal
               ) as nth
        from code_blob_chunks c, words w,
             lateral (select ts_rank_cd(${LEX_WEIGHTS}::float4[], c.search_tsv, w.q) as score) k
        where c.search_tsv @@ w.q and ${holds}
      ) x
      where nth <= ${PER_FILE}
      order by score desc, id
      limit ${CANDIDATES}
    ),
    -- An identifier scores the same in every chunk that contains it, so the
    -- lexical score settles the tie; left alone the order is arbitrary.
    fuzzy as (
      select id, row_number() over (order by sim desc, score desc, id) as rnk, sim as trgm_sim
      from (
        select c.id, k.sim, k.score,
               row_number() over (
                 partition by c.repo_id, c.blob_sha
                 order by k.sim desc, k.score desc, c.ordinal
               ) as nth
        from code_blob_chunks c, words w,
             lateral (
               select word_similarity(${query}, c.chunk_text) as sim,
                      ts_rank_cd(${LEX_WEIGHTS}::float4[], c.search_tsv, w.q) as score
             ) k
        where ${query} <% c.chunk_text and ${holds}
      ) x
      where nth <= ${PER_FILE}
      order by sim desc, score desc, id
      limit ${CANDIDATES}
    ),
    ${fusedCte()},
    scored as (
      select fu.id, fu.cos_sim, fu.fts_rank, fu.trgm_sim,
             fu.rrf + case when numnode(w.defines) > 0 and c.search_tsv @@ w.defines
                           then ${DEFINES_BOOST}::float8 else 0::float8 end as rrf
      from fused fu
      join code_blob_chunks c on c.id = fu.id, words w
    ),
    placed as (
      select s.*, f.path, f.lang, f.line_id,
             row_number() over (
               partition by c.repo_id, f.path order by s.rrf desc, c.start_line
             ) as nth_in_file
      from scored s
      join code_blob_chunks c on c.id = s.id
      join lateral (
        select f.path, f.lang, f.line_id
        from repo_line_files f
        join target_lines tl on tl.id = f.line_id
        where f.repo_id = c.repo_id and f.blob_sha = c.blob_sha ${prefix}
        order by f.path
        limit 1
      ) f on true
    )
    select r.slug as repo_slug, comp.slug as component_slug, cu.slug as customer_slug,
           l.ref as line, l.version_label, l.index_status,
           p.path, p.lang, c.start_line, c.end_line,
           left(c.chunk_text, 1200) as snippet,
           p.cos_sim, p.fts_rank, p.trgm_sim, p.rrf,
           coalesce(l.indexing_commit, l.indexed_commit) as commit,
           l.last_indexed_at,
           extract(day from now() - l.last_indexed_at)::int as indexed_days_ago
    from placed p
    join code_blob_chunks c on c.id = p.id
    join repos r on r.id = c.repo_id
    join repo_lines l on l.id = p.line_id
    left join components comp on comp.id = r.component_id
    left join customers cu on cu.id = r.customer_id
    where p.nth_in_file <= ${PER_FILE}
    order by p.rrf desc, p.path, c.start_line
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

export interface ReadCommit {
  /** The tag, line or branch the commit was reached by. */
  ref: string;
  commit: string;
  /** Set when `ref` is a tracked line, whose index says which blob a path holds. */
  lineId: string | null;
}

/**
 * The commit a read is made at: a release's tag, a tracked line's index, or
 * any other branch or tag the clone has. The default line when neither is
 * named.
 */
export async function resolveReadCommit(
  repoSlug: string,
  opts: { ref?: string; version?: string } = {},
): Promise<ReadCommit> {
  if (opts.version) {
    const resolved = await resolveVersion(repoSlug, opts.version);
    if (!resolved.tag)
      throw notFound(
        `Repo '${repoSlug}' has no release tag for ${resolved.version}; read the '${resolved.line.ref}' line instead`,
      );
    return { ref: resolved.tag, commit: resolved.commit!, lineId: null };
  }

  const repo = await getRepoBySlug(repoSlug);
  const ref = opts.ref ?? repo.default_branch;
  const tracked = repo.lines.find((l) => l.ref === ref);
  if (!tracked) {
    const commit =
      (await resolveRef(repoSlug, `refs/heads/${ref}`)) ??
      (await resolveRef(repoSlug, `refs/tags/${ref}`));
    if (!commit)
      throw notFound(
        `Repo '${repoSlug}' has no branch or tag '${ref}' fetched`,
      );
    return { ref, commit, lineId: null };
  }

  const line = await getRepoLine(repoSlug, tracked.ref);
  const commit = line.indexing_commit ?? line.indexed_commit;
  if (!commit)
    throw badInput(
      `Repo '${repoSlug}' line '${line.ref}' has not been indexed yet`,
    );
  return { ref: line.ref, commit, lineId: line.id };
}

async function contentFor(
  repoSlug: string,
  path: string,
  opts: ReadCodeOptions,
): Promise<{ content: string; ref: string; commit: string }> {
  const at = await resolveReadCommit(repoSlug, opts);
  // The blob, not commit:path: mid-index, a line holds files from two
  // commits, and a search hit must open the content that was found.
  const [file] = at.lineId
    ? await sql`
        select blob_sha from repo_line_files where line_id = ${at.lineId} and path = ${path}
      `
    : [];
  return {
    content: file
      ? await readBlob(repoSlug, file.blob_sha, opts.token)
      : await readFileAt(repoSlug, at.commit, path, opts.token),
    ref: at.ref,
    commit: at.commit,
  };
}

const MAX_DIR_ENTRIES = 300;

/** One directory of a repo, directories first. `dir` is "" for the root. */
export async function listCodeDir(
  repoSlug: string,
  dir: string,
  opts: { ref?: string; version?: string } = {},
) {
  const at = await resolveReadCommit(repoSlug, opts);
  const path = dir.replace(/^\/+|\/+$/g, "");
  const entries = (await listDir(repoSlug, at.commit, path)).sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  );
  return {
    repo: repoSlug,
    path,
    ref: at.ref,
    commit: at.commit,
    entries: entries.slice(0, MAX_DIR_ENTRIES),
    truncated: entries.length > MAX_DIR_ENTRIES,
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

  let numbered: string[] = [];
  let bytes = 0;
  let byteTruncated = false;
  for (let n = start; n <= end; n++) {
    const line = `${n}\t${lines[n - 1]}`;
    bytes += line.length + 1;
    if (bytes > MAX_BYTES) {
      byteTruncated = true;
      break;
    }
    numbered.push(line);
  }
  return {
    repo: repoSlug,
    path,
    ref,
    commit,
    total_lines: lines.length,
    start_line: start,
    end_line: start + numbered.length - 1,
    truncated: byteTruncated || end < requestedEnd || end < lines.length,
    content: numbered.join("\n"),
  };
}
