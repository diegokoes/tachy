import { sql } from "../infra/db";
import { log } from "../infra/log";
import { embedPassages, toVectorLiteral } from "../search/embeddings";
import { chunkCode } from "./chunk-code";
import { cloneOrFetch, listTree, readFileAt, type TreeEntry } from "./git";
import { getRepoBySlug, updateRepoStatus } from "./repos";

const DEFAULT_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "cs",
  "java",
  "kt",
  "go",
  "rs",
  "rb",
  "php",
  "c",
  "h",
  "cpp",
  "hpp",
  "cc",
  "swift",
  "scala",
  "sql",
  "sh",
  "ps1",
  "yaml",
  "yml",
  "json",
  "svelte",
  "vue",
  "md",
  "graphql",
  "proto",
];

const EXCLUDED_DIR_RE =
  /(^|\/)(node_modules|vendor|dist|build|out|target|bin|obj|third_party|\.git|coverage|__pycache__|packages\/generated)(\/|$)/;

const DEFAULT_MAX_FILE_KB = 200;
const PROGRESS_EVERY_FILES = 50;

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  cs: "csharp",
  java: "java",
  kt: "kotlin",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  swift: "swift",
  scala: "scala",
  sql: "sql",
  sh: "shell",
  ps1: "powershell",
  yaml: "yaml",
  yml: "yaml",
  json: "json",
  svelte: "svelte",
  vue: "vue",
  md: "markdown",
  graphql: "graphql",
  proto: "protobuf",
};

const ext = (path: string) =>
  path.slice(path.lastIndexOf(".") + 1).toLowerCase();

function indexableFiles(
  tree: TreeEntry[],
  config: Record<string, unknown>,
): TreeEntry[] {
  const extensions = new Set(
    Array.isArray(config.include_extensions)
      ? (config.include_extensions as string[]).map((e) =>
          e.replace(/^\./, "").toLowerCase(),
        )
      : DEFAULT_EXTENSIONS,
  );
  const maxBytes =
    (typeof config.max_file_kb === "number"
      ? config.max_file_kb
      : DEFAULT_MAX_FILE_KB) * 1024;
  return tree.filter(
    (f) =>
      !EXCLUDED_DIR_RE.test(f.path) &&
      extensions.has(ext(f.path)) &&
      f.sizeBytes > 0 &&
      f.sizeBytes <= maxBytes,
  );
}

async function embedAndStoreFile(
  repoId: string,
  slug: string,
  head: string,
  file: TreeEntry,
): Promise<number> {
  const content = await readFileAt(slug, head, file.path);
  if (content.includes("\0")) return 0;

  const chunks = chunkCode(content);
  const [row] = await sql`
    insert into repo_files (repo_id, path, lang, blob_sha, size_bytes)
    values (${repoId}, ${file.path}, ${LANG_BY_EXT[ext(file.path)] ?? null},
            ${file.blobSha}, ${file.sizeBytes})
    on conflict (repo_id, path) do update
      set blob_sha = excluded.blob_sha,
          size_bytes = excluded.size_bytes,
          lang = excluded.lang
    returning id
  `;
  await sql`delete from code_chunks where file_id = ${row.id}`;
  if (!chunks.length) return 0;

  const vectors = await embedPassages(
    chunks.map((c) => `// ${file.path}\n${c.text}`),
  );
  const literals = vectors.map(toVectorLiteral);
  await sql`
    insert into code_chunks (repo_id, file_id, ordinal, start_line, end_line, chunk_text, embedding)
    select ${repoId}, ${row.id}, u.ordinal, u.start_line, u.end_line, u.chunk_text, u.embedding::vector
    from unnest(
      ${chunks.map((c) => c.ordinal)}::int[],
      ${chunks.map((c) => c.startLine)}::int[],
      ${chunks.map((c) => c.endLine)}::int[],
      ${chunks.map((c) => c.text)}::text[],
      ${literals}::text[]
    ) as u(ordinal, start_line, end_line, chunk_text, embedding)
  `;
  return chunks.length;
}

export interface IndexResult {
  slug: string;
  indexedCommit: string;
  upToDate: boolean;
  filesIndexed: number;
  filesDeleted: number;
  fileCount: number;
  chunkCount: number;
}

/** Clone/fetch and (re)index a linked repo. Diff-only by blob sha; safe to
 * re-run after a failure — indexed_commit only advances on success. Long CPU
 * work: run from the API route (fire-and-forget) or the CLI, never inside a
 * per-turn MCP subprocess. */
export async function indexRepo(
  slug: string,
  opts: { token?: string } = {},
): Promise<IndexResult> {
  const repo = await getRepoBySlug(slug);
  await updateRepoStatus(slug, { indexStatus: "cloning", indexError: null });
  try {
    const head = await cloneOrFetch(
      { slug, url: repo.url, defaultBranch: repo.default_branch },
      opts.token,
    );
    if (head === repo.indexed_commit) {
      await updateRepoStatus(slug, { indexStatus: "ready" });
      return {
        slug,
        indexedCommit: head,
        upToDate: true,
        filesIndexed: 0,
        filesDeleted: 0,
        fileCount: repo.file_count,
        chunkCount: repo.chunk_count,
      };
    }
    await updateRepoStatus(slug, { indexStatus: "indexing" });

    const wanted = indexableFiles(await listTree(slug, head), repo.config);
    const wantedByPath = new Map(wanted.map((f) => [f.path, f]));
    const existing = (await sql`
      select id, path, blob_sha from repo_files where repo_id = ${repo.id}
    `) as unknown as { id: string; path: string; blob_sha: string }[];

    const stalePaths = existing
      .filter((e) => !wantedByPath.has(e.path))
      .map((e) => e.path);
    if (stalePaths.length)
      await sql`
        delete from repo_files
        where repo_id = ${repo.id} and path = any(${stalePaths})
      `;

    const shaByPath = new Map(existing.map((e) => [e.path, e.blob_sha]));
    const changed = wanted.filter((f) => shaByPath.get(f.path) !== f.blobSha);

    let done = 0;
    for (const file of changed) {
      await embedAndStoreFile(repo.id, slug, head, file);
      done++;
      if (done % PROGRESS_EVERY_FILES === 0) {
        const [c] = await sql`
          select count(*)::int as chunks from code_chunks where repo_id = ${repo.id}
        `;
        await updateRepoStatus(slug, { chunkCount: c.chunks });
        log("info", "repo_index_progress", {
          slug,
          done,
          total: changed.length,
        });
      }
    }

    const [counts] = await sql`
      select
        (select count(*)::int from repo_files where repo_id = ${repo.id}) as files,
        (select count(*)::int from code_chunks where repo_id = ${repo.id}) as chunks
    `;
    await updateRepoStatus(slug, {
      indexStatus: "ready",
      indexedCommit: head,
      indexError: null,
      fileCount: counts.files,
      chunkCount: counts.chunks,
      touchIndexedAt: true,
    });
    return {
      slug,
      indexedCommit: head,
      upToDate: false,
      filesIndexed: changed.length,
      filesDeleted: stalePaths.length,
      fileCount: counts.files,
      chunkCount: counts.chunks,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateRepoStatus(slug, {
      indexStatus: "error",
      indexError: message.slice(0, 2000),
    });
    throw err;
  }
}
