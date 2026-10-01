import { matchesGlob } from "node:path";
import { sql } from "../infra/db";
import { log } from "../infra/log";
import { embedPassages, toVectorLiteral } from "../search/embeddings";
import { writeEmbeddings } from "../search/backfill";
import { chunkCode } from "./chunk-code";
import {
  blobSizes,
  describeRelease,
  ensureClone,
  fetchLine,
  listTree,
  prefetchBlobs,
  readBlob,
  resolveRef,
  type TreeEntry,
} from "./git";
import {
  collectOrphanChunks,
  getRepoBySlug,
  recountLine,
  updateLineStatus,
  type RepoLine,
  type RepoRow,
} from "./repos";
import {
  DEFAULT_CODE_EXTENSIONS,
  type IndexPreview,
  type PreviewDir,
} from "@tachy/contract";
import { fileIconOf } from "./file-icons";

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

/** Lowercased, without the dot; empty for a name with none, such as `Makefile`. */
const ext = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/** Never indexed, even when a repo lists them: there is no text to chunk. */
const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "ico",
  "icns",
  "webp",
  "tif",
  "tiff",
  "psd",
  "pdf",
  "zip",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "tar",
  "jar",
  "war",
  "aar",
  "apk",
  "ipa",
  "dll",
  "exe",
  "so",
  "dylib",
  "a",
  "o",
  "lib",
  "class",
  "pyc",
  "bin",
  "dat",
  "db",
  "sqlite",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
  "mp3",
  "mp4",
  "mov",
  "wav",
  "ogg",
  "avi",
  "webm",
  "keystore",
  "jks",
  "p12",
  "pfx",
  "car",
  "nib",
]);

const GLOB_CHARS_RE = /[*?[{]/;

/**
 * `config.exclude`: globs (`scripts/**\/*.json`), or plain paths that exclude
 * everything under them (`other/application/bopools`).
 */
function excludedBy(patterns: string[]): (path: string) => boolean {
  const tests = patterns
    .map((p) => p.trim().replace(/^\/+/, ""))
    .filter(Boolean)
    .map((p) => {
      if (GLOB_CHARS_RE.test(p)) return (path: string) => matchesGlob(path, p);
      const dir = p.replace(/\/+$/, "");
      return (path: string) => path === dir || path.startsWith(`${dir}/`);
    });
  return (path) => tests.some((t) => t(path));
}

export function maxFileBytes(config: Record<string, unknown>): number {
  return (
    (typeof config.max_file_kb === "number"
      ? config.max_file_kb
      : DEFAULT_MAX_FILE_KB) * 1024
  );
}

/** The files a repo's config admits, by path alone. Size is checked later. */
export function indexableFiles(
  tree: TreeEntry[],
  config: Record<string, unknown>,
): TreeEntry[] {
  const extensions = new Set(
    Array.isArray(config.include_extensions)
      ? (config.include_extensions as string[]).map((e) =>
          e.replace(/^\./, "").toLowerCase(),
        )
      : DEFAULT_CODE_EXTENSIONS,
  );
  const excluded = excludedBy(
    Array.isArray(config.exclude) ? (config.exclude as string[]) : [],
  );
  return tree.filter((f) => {
    const e = ext(f.path);
    return (
      !EXCLUDED_DIR_RE.test(f.path) &&
      extensions.has(e) &&
      !BINARY_EXTENSIONS.has(e) &&
      !excluded(f.path)
    );
  });
}

async function upsertFile(
  tx: typeof sql,
  line: RepoLine,
  file: TreeEntry,
  sizeBytes: number,
): Promise<void> {
  await tx`
    insert into repo_line_files (line_id, repo_id, path, lang, blob_sha, size_bytes)
    values (${line.id}, ${line.repo_id}, ${file.path}, ${LANG_BY_EXT[ext(file.path)] ?? null},
            ${file.blobSha}, ${sizeBytes})
    on conflict (line_id, path) do update
      set blob_sha = excluded.blob_sha,
          size_bytes = excluded.size_bytes,
          lang = excluded.lang
  `;
}

/**
 * Embed a blob no line of the repo has yet, then write its chunks and the file
 * row together: a row is never visible without the chunks of its blob, so an
 * interrupted run cannot leave a file marked done with nothing to search.
 */
async function embedAndStoreFile(
  repo: RepoRow,
  line: RepoLine,
  file: TreeEntry,
  sizeBytes: number,
  token: string | undefined,
): Promise<void> {
  const content = await readBlob(repo.slug, file.blobSha, token);
  const chunks = content.includes("\0") ? [] : chunkCode(content);
  const vectors = chunks.length
    ? await embedPassages(chunks.map((c) => `// ${file.path}\n${c.text}`))
    : [];

  await sql.begin(async (tx) => {
    const t = tx as unknown as typeof sql;
    await t`
      delete from code_blob_chunks
      where repo_id = ${line.repo_id} and blob_sha = ${file.blobSha}
    `;
    if (chunks.length)
      await t`
        insert into code_blob_chunks
          (repo_id, blob_sha, ordinal, start_line, end_line, chunk_text, embedding)
        select ${line.repo_id}, ${file.blobSha}, u.ordinal, u.start_line, u.end_line,
               u.chunk_text, u.embedding::vector
        from unnest(
          ${chunks.map((c) => c.ordinal)}::int[],
          ${chunks.map((c) => c.startLine)}::int[],
          ${chunks.map((c) => c.endLine)}::int[],
          ${chunks.map((c) => c.text)}::text[],
          ${vectors.map(toVectorLiteral)}::text[]
        ) as u(ordinal, start_line, end_line, chunk_text, embedding)
      `;
    await upsertFile(t, line, file, sizeBytes);
  });
}

export interface LineIndexResult {
  ref: string;
  indexedCommit: string;
  versionLabel: string | null;
  upToDate: boolean;
  /** Files whose row was written: new paths and changed content. */
  filesIndexed: number;
  /** Of those, the ones whose content had to be embedded; the rest reused a blob. */
  filesEmbedded: number;
  filesDeleted: number;
  fileCount: number;
  chunkCount: number;
}

export interface IndexResult {
  slug: string;
  lines: LineIndexResult[];
}

export interface IndexOptions {
  token?: string;
  /** Index only this line; every tracked line when absent. */
  line?: string;
  signal?: AbortSignal;
  /** `at` places the line among those this call indexes; files done/total are per line. */
  onProgress?: (
    done: number,
    total: number,
    ref: string,
    at: { index: number; count: number },
  ) => void;
}

async function indexLine(
  repo: RepoRow,
  line: RepoLine,
  opts: IndexOptions,
  at: { index: number; count: number },
): Promise<LineIndexResult> {
  const { token, signal } = opts;
  let done = 0;
  let total = 0;
  opts.onProgress?.(0, 0, line.ref, at);
  await updateLineStatus(line.id, { indexStatus: "cloning", indexError: null });
  try {
    await ensureClone(
      { slug: repo.slug, url: repo.url, defaultBranch: repo.default_branch },
      token,
    );
    const head = await fetchLine(repo.slug, line.ref, token);
    await updateLineStatus(line.id, {
      indexStatus: "indexing",
      indexingCommit: head,
    });

    const wanted = indexableFiles(await listTree(repo.slug, head), repo.config);
    const wantedByPath = new Map(wanted.map((f) => [f.path, f]));
    const maxBytes = maxFileBytes(repo.config);

    const existing = (await sql`
      select path, blob_sha, size_bytes from repo_line_files where line_id = ${line.id}
    `) as unknown as { path: string; blob_sha: string; size_bytes: number }[];
    const stalePaths = existing
      .filter((e) => !wantedByPath.has(e.path) || e.size_bytes > maxBytes)
      .map((e) => e.path);
    const shaByPath = new Map(existing.map((e) => [e.path, e.blob_sha]));
    const changed = wanted.filter((f) => shaByPath.get(f.path) !== f.blobSha);

    const known = new Map<string, number>();
    const changedShas = [...new Set(changed.map((f) => f.blobSha))];
    for (const r of await sql`
      select distinct blob_sha, size_bytes from repo_line_files
      where repo_id = ${line.repo_id} and blob_sha = any(${changedShas})
    `)
      known.set(r.blob_sha, r.size_bytes);

    const unseen = changedShas.filter((sha) => !known.has(sha));
    await prefetchBlobs(repo.slug, unseen, token);
    const sizes = await blobSizes(repo.slug, unseen, token);

    const tooBig = new Set(
      changed
        .filter(
          (f) => (known.get(f.blobSha) ?? sizes.get(f.blobSha) ?? 0) > maxBytes,
        )
        .map((f) => f.path),
    );
    for (const path of tooBig) if (shaByPath.has(path)) stalePaths.push(path);
    if (stalePaths.length)
      await sql`
        delete from repo_line_files
        where line_id = ${line.id} and path = any(${stalePaths})
      `;

    const toWrite = changed.filter((f) => !tooBig.has(f.path));
    total = toWrite.length;
    let embedded = 0;
    for (const file of toWrite) {
      signal?.throwIfAborted();
      const reused = known.get(file.blobSha);
      if (reused !== undefined) {
        await upsertFile(sql, line, file, reused);
      } else {
        const size = sizes.get(file.blobSha) ?? 0;
        await embedAndStoreFile(repo, line, file, size, token);
        known.set(file.blobSha, size);
        embedded++;
      }
      done++;
      opts.onProgress?.(done, total, line.ref, at);
      if (done % PROGRESS_EVERY_FILES === 0) {
        await recountLine(line.id);
        log("info", "repo_index_progress", {
          slug: repo.slug,
          ref: line.ref,
          done,
          total,
        });
      }
    }

    await collectOrphanChunks(line.repo_id);
    await recountLine(line.id);
    const versionLabel = await describeRelease(repo.slug, head);
    await updateLineStatus(line.id, {
      indexStatus: "ready",
      indexedCommit: head,
      indexingCommit: null,
      indexError: null,
      versionLabel,
      touchIndexedAt: true,
    });
    const [counts] = await sql`
      select file_count, chunk_count from repo_lines where id = ${line.id}
    `;
    return {
      ref: line.ref,
      indexedCommit: head,
      versionLabel,
      upToDate:
        head === line.indexed_commit && !toWrite.length && !stalePaths.length,
      filesIndexed: toWrite.length,
      filesEmbedded: embedded,
      filesDeleted: stalePaths.length,
      fileCount: counts.file_count,
      chunkCount: counts.chunk_count,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recountLine(line.id);
    await updateLineStatus(line.id, {
      indexStatus: "error",
      indexError: (total
        ? `${message} (after ${done}/${total} files)`
        : message
      ).slice(0, 2000),
    });
    throw err;
  }
}

/**
 * Fetch and (re)index a linked repo's lines. Diff-only by blob sha, and a blob
 * another line already holds is reused rather than embedded again. Safe to
 * re-run after a failure: indexed_commit only advances on success, and what a
 * failed run wrote stays searchable. Long CPU work: run it as a job or from the
 * CLI, never inside a per-turn MCP subprocess.
 */
export async function indexRepo(
  slug: string,
  opts: IndexOptions = {},
): Promise<IndexResult> {
  const repo = await getRepoBySlug(slug);
  // A repo linked before lines existed has none until its first index.
  await sql`
    insert into repo_lines (repo_id, ref) values (${repo.id}, ${repo.default_branch})
    on conflict (repo_id, ref) do nothing
  `;
  const lines = (await sql<RepoLine[]>`
    select * from repo_lines where repo_id = ${repo.id}
    ${opts.line ? sql`and ref = ${opts.line}` : sql``}
    order by ref <> ${repo.default_branch}, ref
  `) as RepoLine[];
  if (opts.line && !lines.length)
    throw new Error(`Repo '${slug}' does not track '${opts.line}'`);
  const results: LineIndexResult[] = [];
  for (const [index, line] of lines.entries())
    results.push(
      await indexLine(repo, line, opts, { index, count: lines.length }),
    );
  return { slug, lines: results };
}

/**
 * What a repo's default line would index under `config` (the repo's own when
 * omitted), counted from trees alone: nothing is fetched beyond commits and
 * trees, and nothing is embedded. Sizes are unknown here, so max_file_kb is
 * not applied.
 */
export async function previewIndex(
  slug: string,
  opts: { config?: Record<string, unknown>; token?: string } = {},
): Promise<IndexPreview> {
  const repo = await getRepoBySlug(slug);
  const ref = repo.default_branch;
  await ensureClone({ slug, url: repo.url, defaultBranch: ref }, opts.token);
  const commit =
    (await resolveRef(slug, `refs/heads/${ref}`)) ??
    (await fetchLine(slug, ref, opts.token));
  const tree = await listTree(slug, commit);
  return { ref, commit, ...countTree(tree, opts.config ?? repo.config) };
}

/** A tree's files by directory and by extension, against what `config` admits. */
export function countTree(
  tree: TreeEntry[],
  config: Record<string, unknown>,
): Omit<IndexPreview, "ref" | "commit"> {
  const admitted = new Set(indexableFiles(tree, config).map((f) => f.path));
  const dirs = new Map<string, PreviewDir>();
  const types = new Map<string, { files: number; admitted: number }>();
  for (const { path } of tree) {
    const ok = admitted.has(path);
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      const d = dirs.get(dir) ?? {
        path: dir,
        files: 0,
        admitted: 0,
        skipped: EXCLUDED_DIR_RE.test(dir),
      };
      d.files++;
      if (ok) d.admitted++;
      dirs.set(dir, d);
    }
    if (EXCLUDED_DIR_RE.test(path)) continue;
    const t = types.get(ext(path)) ?? { files: 0, admitted: 0 };
    t.files++;
    if (ok) t.admitted++;
    types.set(ext(path), t);
  }

  return {
    files_total: tree.length,
    files_admitted: admitted.size,
    dirs: [...dirs.values()].sort((a, b) => a.path.localeCompare(b.path)),
    types: [...types]
      .map(([e, t]) => ({
        ext: e,
        ...t,
        binary: !e || BINARY_EXTENSIONS.has(e),
        ...fileIconOf(e),
      }))
      .sort((a, b) => b.files - a.files || a.ext.localeCompare(b.ext)),
  };
}

/**
 * Re-embed code chunks from their stored text, without touching git. `all: true`
 * rebuilds every vector after a model change — far cheaper than re-cloning and
 * re-indexing every repo just to get new vectors for text that has not changed.
 */
export async function backfillCodeEmbeddings(
  opts: { all?: boolean } = {},
): Promise<number> {
  // A blob held at several paths was embedded under whichever came first;
  // any one of them gives the same shape of text.
  const rows = await sql`
    select c.id, c.chunk_text,
           (select min(f.path) from repo_line_files f
            where f.repo_id = c.repo_id and f.blob_sha = c.blob_sha) as path
    from code_blob_chunks c
    ${opts.all ? sql`` : sql`where c.embedding is null`}
    order by c.repo_id, c.blob_sha, c.ordinal
  `;
  return writeEmbeddings(
    "code_blob_chunks",
    // Same shape as indexing, or the query and the stored vector disagree.
    rows.map((r) => ({
      id: r.id,
      text: `// ${r.path ?? ""}\n${r.chunk_text}`,
    })),
  );
}
