import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { RELEASE_TAG_RE, SLUG_RE } from "@tachy/contract";
import type { RemoteRef } from "@tachy/contract";
import { badInput, notFound } from "../infra/errors";
import { maskSecrets, rememberSecret } from "../infra/known-secrets";

const MAX_BUFFER = 256 * 1024 * 1024;
const PREFETCH_BATCH = 1000;
const LS_REMOTE_TIMEOUT_MS = 30_000;

function reposRoot(): string {
  return process.env.TACHY_REPO_DIR ?? join(process.cwd(), "data", "repos");
}

/** The repo's bare partial clone. */
export function repoDir(slug: string): string {
  if (!SLUG_RE.test(slug)) throw badInput(`invalid repo slug '${slug}'`);
  return join(reposRoot(), `${slug}.git`);
}

/** The single-branch checkout layout, removed when the partial clone is made. */
function checkoutDir(slug: string): string {
  return join(reposRoot(), slug);
}

/**
 * `execFile` keeps a shell out of it, but git parses its own arguments: a
 * positional beginning with `-` becomes an option (`--upload-pack=` runs a
 * command), and the `ext::` transport runs one outright. So the remote is one
 * of the shapes cloned from here. `file://` is among them because it only reads
 * a repository, and it is how tests index a local clone.
 */
const REPO_URL_RE = /^(?:https?:\/\/|ssh:\/\/|file:\/\/|git@)[A-Za-z0-9\/]/;

export function assertRepoUrl(url: string): string {
  if (!REPO_URL_RE.test(url))
    throw badInput(
      `'${url}' is not a repository URL; expected https://host/path, ssh://host/path or git@host:path`,
    );
  return url;
}

/**
 * A ref name reaches git as a positional too. Narrower than git's own rules:
 * the branch and tag names in use.
 */
export function assertBranchName(branch: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(branch) || branch.includes(".."))
    throw badInput(`'${branch}' is not a valid branch name`);
  return branch;
}

const OID_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

function assertOid(oid: string): string {
  if (!OID_RE.test(oid)) throw badInput(`'${oid}' is not an object id`);
  return oid;
}

/**
 * The PAT travels only as a per-invocation header, never into the clone's
 * config, and in the environment rather than argv: a command line is readable
 * by every process on the host. The fetch git spawns for a missing blob
 * inherits the environment, so a lazy read authenticates too.
 */
export function authEnv(token?: string): Record<string, string> {
  if (!token) return {};
  const b64 = rememberSecret(Buffer.from(`:${token}`).toString("base64"));
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${b64}`,
  };
}

/** Options that take their value as the next argument, ahead of the subcommand. */
const GLOBAL_OPTIONS_WITH_VALUE = new Set(["-C", "-c"]);

function subcommandOf(args: string[]): string {
  let i = 0;
  while (GLOBAL_OPTIONS_WITH_VALUE.has(args[i])) i += 2;
  return args[i] ?? "";
}

/** `https://user:secret@host/path` without the `user:secret@`. */
export const withoutUrlCredentials = (text: string): string =>
  text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\/\s@]+@/gi, "$1");

/**
 * What a failed git call reports. Built from git's own stderr: the error
 * `execFile` raises quotes the whole command line.
 */
function gitFailure(
  args: string[],
  failure: { killed?: boolean },
  stderr: string,
): Error {
  const subcommand = subcommandOf(args);
  if (failure.killed) return new Error(`git ${subcommand} timed out`);
  const detail = maskSecrets(withoutUrlCredentials(stderr.trim()));
  return new Error(
    detail ? `git ${subcommand} failed: ${detail}` : `git ${subcommand} failed`,
  );
}

function run(
  args: string[],
  opts: { token?: string; input?: string; timeout?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      args,
      {
        maxBuffer: MAX_BUFFER,
        timeout: opts.timeout,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          ...authEnv(opts.token),
        },
      },
      (err, stdout, stderr) =>
        err ? reject(gitFailure(args, err, stderr)) : resolve(stdout),
    );
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
}

const git = (
  slug: string,
  args: string[],
  opts: { token?: string; input?: string } = {},
) => run(["-C", repoDir(slug), ...args], opts);

/**
 * Make sure the repo has a partial clone: every commit and tree, and file
 * contents only as they are read. That is what lets any release tag be read
 * without keeping a checkout per version.
 */
export async function ensureClone(
  repo: { slug: string; url: string; defaultBranch: string },
  token?: string,
): Promise<void> {
  const dir = repoDir(repo.slug);
  if (existsSync(join(dir, "HEAD"))) return;
  await rm(checkoutDir(repo.slug), { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await run(
    [
      "clone",
      "--bare",
      "--quiet",
      "--filter=blob:none",
      "--single-branch",
      "--branch",
      assertBranchName(repo.defaultBranch),
      "--",
      assertRepoUrl(repo.url),
      dir,
    ],
    { token },
  ).catch(async (err) => {
    await rm(dir, { recursive: true, force: true });
    throw err;
  });
}

/** Fetch one line's branch and every tag; returns the branch head. */
export async function fetchLine(
  slug: string,
  ref: string,
  token?: string,
): Promise<string> {
  assertBranchName(ref);
  await git(
    slug,
    [
      "fetch",
      "--quiet",
      "--force",
      "origin",
      `refs/heads/${ref}:refs/heads/${ref}`,
      "refs/tags/*:refs/tags/*",
    ],
    { token },
  );
  return (await git(slug, ["rev-parse", `refs/heads/${ref}^{commit}`])).trim();
}

export interface TreeEntry {
  path: string;
  blobSha: string;
}

/** Every file at a commit, from trees alone: no content is fetched. */
export async function listTree(
  slug: string,
  sha: string,
): Promise<TreeEntry[]> {
  const stdout = await git(slug, ["ls-tree", "-r", "-z", assertOid(sha)]);
  const entries: TreeEntry[] = [];
  for (const line of stdout.split("\0")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const [, type, blobSha] = line.slice(0, tab).split(/\s+/);
    if (type !== "blob") continue;
    entries.push({ path: line.slice(tab + 1), blobSha });
  }
  return entries;
}

/**
 * Fetch file contents in bulk. Left to git, a partial clone fetches each
 * missing blob on its own round trip as it is read, which is one HTTP request
 * per file. Best effort: whatever this misses is still fetched on read.
 */
export async function prefetchBlobs(
  slug: string,
  oids: string[],
  token?: string,
): Promise<void> {
  for (let i = 0; i < oids.length; i += PREFETCH_BATCH) {
    const batch = oids.slice(i, i + PREFETCH_BATCH).map(assertOid);
    await git(
      slug,
      [
        "-c",
        "fetch.negotiationAlgorithm=noop",
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-write-fetch-head",
        "--recurse-submodules=no",
        "--filter=blob:none",
        "--stdin",
        "origin",
      ],
      { token, input: batch.join("\n") + "\n" },
    ).catch(() => {});
  }
}

/** Byte size of each blob, fetching any that are still missing. */
export async function blobSizes(
  slug: string,
  oids: string[],
  token?: string,
): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  if (!oids.length) return sizes;
  const stdout = await git(
    slug,
    ["cat-file", "--batch-check=%(objectname) %(objectsize)"],
    { token, input: oids.map(assertOid).join("\n") + "\n" },
  );
  for (const line of stdout.split("\n")) {
    const [oid, size] = line.split(" ");
    if (oid && size && /^\d+$/.test(size)) sizes.set(oid, Number(size));
  }
  return sizes;
}

export async function readBlob(
  slug: string,
  oid: string,
  token?: string,
): Promise<string> {
  return git(slug, ["cat-file", "blob", assertOid(oid)], { token });
}

/** A file as it is at `rev`, a commit or a ref name. */
export async function readFileAt(
  slug: string,
  rev: string,
  path: string,
  token?: string,
): Promise<string> {
  if (!OID_RE.test(rev)) assertBranchName(rev);
  try {
    return await git(slug, ["show", `${rev}:${path}`], { token });
  } catch {
    throw notFound(
      `'${path}' not found in repo '${slug}' at ${OID_RE.test(rev) ? rev.slice(0, 12) : rev}`,
    );
  }
}

/** The commit a local ref points at, or null. */
export async function resolveRef(
  slug: string,
  ref: string,
): Promise<string | null> {
  if (!existsSync(join(repoDir(slug), "HEAD"))) return null;
  try {
    return (
      await git(slug, [
        "rev-parse",
        "--verify",
        "--quiet",
        `${assertBranchName(ref)}^{commit}`,
      ])
    ).trim();
  } catch {
    return null;
  }
}

/**
 * The newest release tag reachable from a commit: the version a line is at.
 * Pre-release tags carry a `-` suffix and are skipped.
 */
export async function describeRelease(
  slug: string,
  sha: string,
): Promise<string | null> {
  for (const match of ["v[0-9]*", "[0-9]*"]) {
    try {
      const tag = (
        await git(slug, [
          "describe",
          "--tags",
          "--abbrev=0",
          "--match",
          match,
          "--exclude",
          "*-*",
          assertOid(sha),
        ])
      ).trim();
      if (RELEASE_TAG_RE.test(tag)) return tag;
    } catch {
      continue;
    }
  }
  return null;
}

export interface CommitSummary {
  sha: string;
  author: string;
  date: string;
  subject: string;
}

export async function logBetween(
  slug: string,
  from: string,
  to: string,
  opts: { path?: string; limit: number },
): Promise<CommitSummary[]> {
  const stdout = await git(slug, [
    "log",
    `--max-count=${opts.limit}`,
    "--format=%H%x1f%an%x1f%aI%x1f%s",
    `${from}..${to}`,
    "--",
    ...(opts.path ? [opts.path] : []),
  ]);
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, author, date, subject] = line.split("\x1f");
      return { sha, author, date, subject };
    });
}

const ABBREVIATED_OID_RE = /^[0-9a-f]{7,64}$/;

/** The full id of a commit named by its id or an abbreviation of it, or null. */
export async function resolveCommit(
  slug: string,
  oid: string,
): Promise<string | null> {
  if (!ABBREVIATED_OID_RE.test(oid)) return null;
  if (!existsSync(join(repoDir(slug), "HEAD"))) return null;
  try {
    return (
      await git(slug, ["rev-parse", "--verify", "--quiet", `${oid}^{commit}`])
    ).trim();
  } catch {
    return null;
  }
}

export interface DirEntry {
  name: string;
  kind: "dir" | "file";
}

const DIR_ENTRY_KINDS: Record<string, DirEntry["kind"]> = {
  tree: "dir",
  blob: "file",
};

/** One directory at a commit, from trees alone. `dir` is "" for the root. */
export async function listDir(
  slug: string,
  sha: string,
  dir: string,
): Promise<DirEntry[]> {
  const treeish = dir ? `${assertOid(sha)}:${dir}` : assertOid(sha);
  let stdout: string;
  try {
    stdout = await git(slug, ["ls-tree", "-z", treeish]);
  } catch {
    throw notFound(
      `'${dir}' is not a directory in repo '${slug}' at ${sha.slice(0, 12)}`,
    );
  }
  const entries: DirEntry[] = [];
  for (const line of stdout.split("\0")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const kind = DIR_ENTRY_KINDS[line.slice(0, tab).split(/\s+/)[1]];
    if (kind) entries.push({ name: line.slice(tab + 1), kind });
  }
  return entries;
}

/** The tree of a commit with no parent, to diff a root commit against. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** The first parent of a commit, or the empty tree for a root commit. */
export async function parentOf(slug: string, sha: string): Promise<string> {
  try {
    return (
      await git(slug, [
        "rev-parse",
        "--verify",
        "--quiet",
        `${assertOid(sha)}^^{commit}`,
      ])
    ).trim();
  } catch {
    return EMPTY_TREE;
  }
}

export async function commitSummary(
  slug: string,
  sha: string,
): Promise<CommitSummary> {
  const stdout = await git(slug, [
    "log",
    "--max-count=1",
    "--format=%H%x1f%an%x1f%aI%x1f%s",
    assertOid(sha),
  ]);
  const [id, author, date, subject] = stdout.trim().split("\x1f");
  return { sha: id, author, date, subject };
}

export interface ChangedFile {
  /** Git's status letter: A, M, D, R, C or T. */
  status: string;
  path: string;
}

const pathArgs = (path?: string) => ["--", ...(path ? [path] : [])];

/** The files that differ between two commits, from trees alone. */
export async function changedFiles(
  slug: string,
  from: string,
  to: string,
  path?: string,
): Promise<ChangedFile[]> {
  const stdout = await git(slug, [
    "diff",
    "--name-status",
    "--no-renames",
    "-z",
    assertOid(from),
    assertOid(to),
    ...pathArgs(path),
  ]);
  const fields = stdout.split("\0").filter(Boolean);
  const files: ChangedFile[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2)
    files.push({ status: fields[i], path: fields[i + 1] });
  return files;
}

/**
 * The patch between two commits. It reads file contents, so a partial clone
 * fetches the blobs on either side: bound it with `changedFiles` first.
 */
export async function diffBetween(
  slug: string,
  from: string,
  to: string,
  opts: { path?: string; token?: string } = {},
): Promise<string> {
  return git(
    slug,
    [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-renames",
      assertOid(from),
      assertOid(to),
      ...pathArgs(opts.path),
    ],
    { token: opts.token },
  );
}

/** The release tags whose history holds a commit, oldest version first. */
export async function releasesContaining(
  slug: string,
  sha: string,
): Promise<string[]> {
  const stdout = await git(slug, [
    "tag",
    "--contains",
    assertOid(sha),
    "--sort=version:refname",
  ]);
  return stdout.split("\n").filter((tag) => RELEASE_TAG_RE.test(tag));
}

/** Whether a branch's history holds a commit. */
export async function branchContains(
  slug: string,
  branch: string,
  sha: string,
): Promise<boolean> {
  try {
    await git(slug, [
      "merge-base",
      "--is-ancestor",
      assertOid(sha),
      `refs/heads/${assertBranchName(branch)}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

/** The branches and tags a remote offers, without cloning it. */
export async function listRemoteRefs(
  url: string,
  token?: string,
  opts: { heads?: string[] } = {},
): Promise<RemoteRef[]> {
  const stdout = await run(
    [
      "ls-remote",
      "--heads",
      ...(opts.heads ? [] : ["--tags"]),
      "--refs",
      assertRepoUrl(url),
      ...(opts.heads ?? []).map(assertBranchName),
    ],
    { token, timeout: LS_REMOTE_TIMEOUT_MS },
  );
  const refs: RemoteRef[] = [];
  for (const line of stdout.split("\n")) {
    const name = line.split("\t")[1];
    if (name?.startsWith("refs/heads/"))
      refs.push({ name: name.slice("refs/heads/".length), kind: "branch" });
    else if (name?.startsWith("refs/tags/"))
      refs.push({ name: name.slice("refs/tags/".length), kind: "tag" });
  }
  return refs;
}

const RELEASE_BRANCHES = ["master", "main"];

/**
 * The branch to index when linking a repo. Releases are tagged on `master` or
 * `main`; a remote's default is often `develop`, which is ahead of every
 * release a customer runs. Falls back to the remote's default.
 */
export async function releaseBranch(
  url: string,
  fallback: string,
  token?: string,
): Promise<string> {
  try {
    const found = new Set(
      (await listRemoteRefs(url, token, { heads: RELEASE_BRANCHES })).map(
        (r) => r.name,
      ),
    );
    return RELEASE_BRANCHES.find((b) => found.has(b)) ?? fallback;
  } catch {
    return fallback;
  }
}

export async function removeClone(slug: string): Promise<void> {
  await rm(repoDir(slug), { recursive: true, force: true });
  await rm(checkoutDir(slug), { recursive: true, force: true });
}
