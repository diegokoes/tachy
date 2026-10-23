/**
 * A repo laid out in one read: its folders as deep as a size budget allows,
 * and the files they hold with the names each defines. Built from what the
 * indexer stored, so files an admin excluded are absent, and asking for it
 * costs the agent one call instead of a folder per call. No doc text goes in:
 * a repo's own docs can be out of date, and the map stands for its code.
 */
import { sql } from "../infra/db";
import { definedSymbols, fileStem } from "./symbols";

/** Characters the folder structure may take before folders stay folded. */
const STRUCTURE_CHARS = 2400;
/** Characters the whole tree may take, the names added to files included. */
export const MAX_MAP_CHARS = 3200;
/** Files one folder lists before the rest are only counted. */
const MAX_LISTED_FILES = 15;
const MAX_NAMES_PER_FILE = 4;
const INDENT = "  ";

interface Folder {
  name: string;
  depth: number;
  folders: Folder[];
  /** Paths of the files directly inside, in path order. */
  files: string[];
  /** Files anywhere beneath. */
  fileCount: number;
  open: boolean;
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const counted = (n: number) => `${n} file${n === 1 ? "" : "s"}`;

function folderTree(paths: string[]): Folder {
  const root: Folder = {
    name: "",
    depth: -1,
    folders: [],
    files: [],
    fileCount: 0,
    open: true,
  };
  for (const path of paths) {
    let at = root;
    const dirs = path.split("/").slice(0, -1);
    for (const dir of dirs) {
      let next = at.folders.find((f) => f.name === dir);
      if (!next) {
        next = {
          name: dir,
          depth: 0,
          folders: [],
          files: [],
          fileCount: 0,
          open: false,
        };
        at.folders.push(next);
      }
      at = next;
    }
    at.files.push(path);
  }
  settle(root, -1);
  return root;
}

/**
 * Folds a folder holding one folder and no files into its child, so
 * `scripts/src/main/js/` reads as one line; then sets depths and counts.
 */
function settle(folder: Folder, depth: number): number {
  folder.depth = depth;
  folder.folders.sort((a, b) => a.name.localeCompare(b.name));
  for (const sub of folder.folders)
    while (sub.files.length === 0 && sub.folders.length === 1) {
      const [only] = sub.folders;
      sub.name = `${sub.name}/${only.name}`;
      sub.folders = only.folders;
      sub.files = only.files;
    }
  folder.fileCount =
    folder.files.length +
    folder.folders.reduce((sum, sub) => sum + settle(sub, depth + 1), 0);
  return folder.fileCount;
}

const folderLine = (folder: Folder) =>
  `${INDENT.repeat(folder.depth)}${folder.name}/ (${counted(folder.fileCount)})`;

/** The lines a folder adds when it opens: its folders, then its files. */
function openedLines(folder: Folder): { text: string; path?: string }[] {
  const indent = INDENT.repeat(folder.depth + 1);
  const shown = folder.files.slice(0, MAX_LISTED_FILES);
  const rest = folder.files.length - shown.length;
  return [
    ...folder.folders.map((sub) => ({ text: folderLine(sub) })),
    ...shown.map((path) => ({ text: indent + baseName(path), path })),
    ...(rest > 0
      ? [{ text: `${indent}+ ${rest} more file${rest === 1 ? "" : "s"}` }]
      : []),
  ];
}

const charsOf = (lines: { text: string }[]) =>
  lines.reduce((sum, line) => sum + line.text.length + 1, 0);

/**
 * Test, mock and fixture folders: what a repo does is in its other folders,
 * so these open only once every other folder has had its turn.
 */
const TEST_FOLDER_RE =
  /(^|[-_./])(tests?|testing|tester|specs?|mocks?|fixtures?|e2e|__tests__)([-_./]|$)/i;

/**
 * Opens folders breadth-first, shallow before deep, while the structure fits;
 * test folders after the rest.
 */
function unfold(root: Folder): void {
  let used = charsOf(openedLines(root));
  const openWhileFits = (start: Folder[], deferred?: Folder[]) => {
    const queue = [...start];
    while (queue.length) {
      const folder = queue.shift()!;
      if (deferred && TEST_FOLDER_RE.test(folder.name)) {
        deferred.push(folder);
        continue;
      }
      const cost = charsOf(openedLines(folder));
      if (used + cost > STRUCTURE_CHARS) continue;
      folder.open = true;
      used += cost;
      queue.push(...folder.folders);
    }
  };
  const tests: Folder[] = [];
  openWhileFits(root.folders, tests);
  openWhileFits(tests);
}

function linesOf(folder: Folder): { text: string; path?: string }[] {
  return openedLines(folder).flatMap((line, i) => {
    const sub = i < folder.folders.length ? folder.folders[i] : undefined;
    return sub?.open ? [line, ...linesOf(sub)] : [line];
  });
}

/**
 * The tree of `paths` as indented lines, and the paths it lists by name.
 * `names` adds what each file defines, file by file, while the tree fits.
 */
export function drawRepoTree(
  paths: string[],
  names: Map<string, string[]> = new Map(),
): { text: string; listed: string[] } {
  const root = folderTree(paths);
  unfold(root);
  const lines = linesOf(root);
  let used = charsOf(lines);
  for (const line of lines) {
    const defined = line.path ? names.get(line.path) : undefined;
    if (!defined?.length) continue;
    const added = `: ${defined.join(", ")}`;
    if (used + added.length > MAX_MAP_CHARS) continue;
    line.text += added;
    used += added.length;
  }
  return {
    text: lines.map((line) => line.text).join("\n"),
    listed: lines.flatMap((line) => (line.path ? [line.path] : [])),
  };
}

export interface RepoMap {
  repo: string;
  ref: string;
  commit: string;
  indexed_files: number;
  tree: string;
}

interface LineFile {
  path: string;
  blob_sha: string;
}

/** What each file defines, from its stored chunks, its own name left out. */
async function definedNames(
  repoId: string,
  files: LineFile[],
): Promise<Map<string, string[]>> {
  if (!files.length) return new Map();
  const chunks = await sql<{ blob_sha: string; chunk_text: string }[]>`
    select blob_sha, chunk_text from code_blob_chunks
    where repo_id = ${repoId} and blob_sha = any(${files.map((f) => f.blob_sha)})
    order by blob_sha, ordinal
  `;
  const textOf = new Map<string, string[]>();
  for (const chunk of chunks)
    textOf.set(chunk.blob_sha, [
      ...(textOf.get(chunk.blob_sha) ?? []),
      chunk.chunk_text,
    ]);
  return new Map(
    files.map((file) => {
      const stem = fileStem(file.path);
      const defined = new Set(
        (textOf.get(file.blob_sha) ?? []).flatMap(definedSymbols),
      );
      defined.delete(stem);
      return [file.path, [...defined].slice(0, MAX_NAMES_PER_FILE)];
    }),
  );
}

/**
 * The map of a repo's default line, or of the tracked line `ref` names. Null
 * when that line is not tracked or not indexed yet, for the caller to list
 * the directory from git instead.
 */
export async function repoMap(
  slug: string,
  opts: { ref?: string } = {},
): Promise<RepoMap | null> {
  const [line] = await sql<
    {
      id: string;
      repo_id: string;
      ref: string;
      indexed_commit: string | null;
    }[]
  >`
    select l.id, l.repo_id, l.ref, l.indexed_commit
    from repo_lines l join repos r on r.id = l.repo_id
    where r.slug = ${slug} and l.ref = coalesce(${opts.ref ?? null}, r.default_branch)
  `;
  if (!line?.indexed_commit) return null;
  const files = await sql<LineFile[]>`
    select path, blob_sha from repo_line_files
    where line_id = ${line.id} order by path
  `;
  const paths = files.map((f) => f.path);
  const { listed } = drawRepoTree(paths);
  const shown = new Set(listed);
  const names = await definedNames(
    line.repo_id,
    files.filter((f) => shown.has(f.path)),
  );
  return {
    repo: slug,
    ref: line.ref,
    commit: line.indexed_commit,
    indexed_files: files.length,
    tree: drawRepoTree(paths, names).text,
  };
}
