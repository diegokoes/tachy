import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { RELEASE_TAG_RE, SLUG_RE } from "@tachy/contract";
import type { RemoteRef } from "@tachy/contract";
import { badInput, notFound } from "../infra/errors";

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
 * command), and the `ext::` transport is documented as running one outright. So
 * the remote has to be one of the shapes we actually clone from, not merely
 * "not shell metacharacters".
 *
 * `file://` is on the list because it cannot run anything - it reads a git
 * repository and nothing else - and it is how a local clone is indexed in
 * tests. The transports that execute are the ones missing from it.
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
 * A ref name reaches git as a positional too, so the same reasoning applies.
 * This is narrower than git's own rules deliberately - it is the set of branch
 * and tag names anyone actually has.
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
 * config. Git hands `-c` settings down to the fetch it spawns for a missing
 * blob, so a lazy read authenticates too.
 */
function authArgs(token?: string): string[] {
  if (!token) return [];
  const b64 = Buffer.from(`:${token}`).toString("base64");
  return ["-c", `http.extraHeader=Authorization: Basic ${b64}`];
}

function run(
  args: string[],
  opts: { input?: string; timeout?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      args,
      {
        maxBuffer: MAX_BUFFER,
        timeout: opts.timeout,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
}

const git = (
  slug: string,
  args: string[],
  opts: { token?: string; input?: string } = {},
) => run(["-C", repoDir(slug), ...authArgs(opts.token), ...args], opts);

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
  await run([
    ...authArgs(token),
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
  ]).catch(async (err) => {
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
  const out = await git(slug, ["ls-tree", "-r", "-z", assertOid(sha)]);
  const entries: TreeEntry[] = [];
  for (const line of out.split("\0")) {
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
  const out = await git(
    slug,
    ["cat-file", "--batch-check=%(objectname) %(objectsize)"],
    { token, input: oids.map(assertOid).join("\n") + "\n" },
  );
  for (const line of out.split("\n")) {
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
  const out = await git(slug, [
    "log",
    `--max-count=${opts.limit}`,
    "--format=%H%x1f%an%x1f%aI%x1f%s",
    `${from}..${to}`,
    "--",
    ...(opts.path ? [opts.path] : []),
  ]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, author, date, subject] = line.split("\x1f");
      return { sha, author, date, subject };
    });
}

/** The branches and tags a remote offers, without cloning it. */
export async function listRemoteRefs(
  url: string,
  token?: string,
  opts: { heads?: string[] } = {},
): Promise<RemoteRef[]> {
  const out = await run(
    [
      ...authArgs(token),
      "ls-remote",
      "--heads",
      ...(opts.heads ? [] : ["--tags"]),
      "--refs",
      assertRepoUrl(url),
      ...(opts.heads ?? []).map(assertBranchName),
    ],
    { timeout: LS_REMOTE_TIMEOUT_MS },
  );
  const refs: RemoteRef[] = [];
  for (const line of out.split("\n")) {
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
