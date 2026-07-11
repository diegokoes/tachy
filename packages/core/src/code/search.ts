import { sql } from "../infra/db";
import { badInput } from "../infra/errors";
import { embedQuery, toVectorLiteral } from "../search/embeddings";
import { getRepoBySlug } from "./repos";
import { readFileAt } from "./git";

export interface CodeSearchOptions {
  repoSlug?: string;
  productId?: string;
  pathPrefix?: string;
  limit?: number;
}

export async function searchCode(query: string, opts: CodeSearchOptions = {}) {
  if (!query.trim()) return [];
  const limit = Math.min(opts.limit ?? 8, 25);
  const qvec = toVectorLiteral(await embedQuery(query));
  return sql`
    select r.slug as repo_slug, f.path, f.lang, c.start_line, c.end_line,
           left(c.chunk_text, 1200) as snippet,
           (1 - (c.embedding <=> ${qvec}::vector)) + similarity(c.chunk_text, ${query}) as score,
           r.indexed_commit, r.last_indexed_at,
           extract(day from now() - r.last_indexed_at)::int as indexed_days_ago
    from code_chunks c
    join repo_files f on f.id = c.file_id
    join repos r on r.id = c.repo_id
    where r.index_status in ('ready','indexing')
      ${opts.repoSlug ? sql`and r.slug = ${opts.repoSlug}` : sql``}
      ${opts.productId ? sql`and r.product_id = ${opts.productId}` : sql``}
      ${opts.pathPrefix ? sql`and f.path like ${opts.pathPrefix + "%"}` : sql``}
    order by score desc
    limit ${limit}
  `;
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
