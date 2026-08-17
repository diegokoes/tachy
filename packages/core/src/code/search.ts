import { sql } from "../infra/db";
import { badInput } from "../infra/errors";
import { embedQueryLiteral } from "../search/embeddings";
import {
  CANDIDATES,
  clampLimit,
  fusedCte,
  withSearchSession,
} from "../search/rank";
import { SEM_FLOOR, withRelevance } from "../search/relevance";
import { getRepoBySlug } from "./repos";
import { readFileAt } from "./git";

export interface CodeSearchOptions {
  repoSlug?: string;
  productId?: string;
  componentId?: string;
  sourceProjectId?: string;
  pathPrefix?: string;
  limit?: number;
  /** Pre-embedded query, so a caller searching two surfaces embeds once. */
  queryVector?: string;
}

export async function searchCode(query: string, opts: CodeSearchOptions = {}) {
  if (!query.trim()) return [];
  const limit = clampLimit(opts.limit, 8);
  const qvec = opts.queryVector ?? (await embedQueryLiteral(query));

  // `like` treats % and _ as wildcards; a path prefix is a literal.
  const escapedPrefix = opts.pathPrefix?.replace(/([%_\\])/g, "\\$1");

  const filters = sql`
    r.index_status in ('ready','indexing')
    ${opts.repoSlug ? sql`and r.slug = ${opts.repoSlug}` : sql``}
    ${opts.productId ? sql`and r.product_id = ${opts.productId}` : sql``}
    ${opts.componentId ? sql`and r.component_id = ${opts.componentId}` : sql``}
    ${opts.sourceProjectId ? sql`and r.source_project_id = ${opts.sourceProjectId}` : sql``}
    ${escapedPrefix ? sql`and f.path like ${escapedPrefix + "%"}` : sql``}
  `;

  const rows = await withSearchSession(
    (tx) => tx`
    with
    vec as (
      select c.id,
             row_number() over (order by c.embedding <=> ${qvec}::vector) as rnk,
             1 - (c.embedding <=> ${qvec}::vector) as cos_sim
      from code_chunks c
      join repo_files f on f.id = c.file_id
      join repos r on r.id = c.repo_id
      where ${filters} and c.embedding is not null
        and 1 - (c.embedding <=> ${qvec}::vector) >= ${SEM_FLOOR}
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
      from code_chunks c
      join repo_files f on f.id = c.file_id
      join repos r on r.id = c.repo_id
      where ${filters} and ${query} <% c.chunk_text
      order by word_similarity(${query}, c.chunk_text) desc
      limit ${CANDIDATES}
    ),
    ${fusedCte()}
    select r.slug as repo_slug, comp.slug as component_slug,
           f.path, f.lang, c.start_line, c.end_line,
           left(c.chunk_text, 1200) as snippet,
           fu.cos_sim, fu.fts_rank, fu.trgm_sim, fu.rrf,
           r.indexed_commit, r.last_indexed_at,
           extract(day from now() - r.last_indexed_at)::int as indexed_days_ago
    from fused fu
    join code_chunks c on c.id = fu.id
    join repo_files f on f.id = c.file_id
    join repos r on r.id = c.repo_id
    left join components comp on comp.id = r.component_id
    order by fu.rrf desc, f.path, c.start_line
    limit ${limit}
  `,
  );
  return (rows as unknown as Parameters<typeof withRelevance>[0][]).map(
    withRelevance,
  );
}

const MAX_LINES = 400;
const MAX_BYTES = 64 * 1024;

export async function readCodeFile(
  repoSlug: string,
  path: string,
  opts: { startLine?: number; endLine?: number } = {},
) {
  const repo = await getRepoBySlug(repoSlug);
  if (!repo.indexed_commit)
    throw badInput(`Repo '${repoSlug}' has not been indexed yet`);
  const content = await readFileAt(repoSlug, repo.indexed_commit, path);
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
    indexed_commit: repo.indexed_commit,
    total_lines: lines.length,
    start_line: start,
    end_line: start + out.length - 1,
    truncated: byteTruncated || end < requestedEnd || end < lines.length,
    content: out.join("\n"),
  };
}
