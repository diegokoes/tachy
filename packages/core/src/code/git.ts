import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { badInput, notFound } from "../infra/errors";

const run = promisify(execFile);
const MAX_BUFFER = 256 * 1024 * 1024;

export function repoDir(slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug))
    throw badInput(`invalid repo slug '${slug}'`);
  return join(
    process.env.TACHY_REPO_DIR ?? join(process.cwd(), "data", "repos"),
    slug,
  );
}

function authArgs(token?: string): string[] {
  if (!token) return [];
  const b64 = Buffer.from(`:${token}`).toString("base64");
  return ["-c", `http.extraHeader=Authorization: Basic ${b64}`];
}

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", dir, ...args], {
    maxBuffer: MAX_BUFFER,
  });
  return stdout;
}

/** Shallow-clone or shallow-fetch the repo; returns the new head sha. The PAT
 * travels only as a per-invocation header, never into .git/config. */
export async function cloneOrFetch(
  repo: { slug: string; url: string; defaultBranch: string },
  token?: string,
): Promise<string> {
  const dir = repoDir(repo.slug);
  if (!existsSync(join(dir, ".git"))) {
    await mkdir(dir, { recursive: true });
    await run(
      "git",
      [
        ...authArgs(token),
        "clone",
        "--depth",
        "1",
        "--single-branch",
        "-b",
        repo.defaultBranch,
        repo.url,
        dir,
      ],
      { maxBuffer: MAX_BUFFER },
    );
  } else {
    await run(
      "git",
      [
        "-C",
        dir,
        ...authArgs(token),
        "fetch",
        "--depth",
        "1",
        "origin",
        repo.defaultBranch,
      ],
      { maxBuffer: MAX_BUFFER },
    );
    await git(dir, ["reset", "--hard", "FETCH_HEAD"]);
  }
  return (await git(dir, ["rev-parse", "HEAD"])).trim();
}

export interface TreeEntry {
  path: string;
  blobSha: string;
  sizeBytes: number;
}

export async function listTree(
  slug: string,
  sha: string,
): Promise<TreeEntry[]> {
  const out = await git(repoDir(slug), ["ls-tree", "-r", "-l", "-z", sha]);
  const entries: TreeEntry[] = [];
  for (const line of out.split("\0")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const [, type, blobSha, size] = line.slice(0, tab).split(/\s+/);
    if (type !== "blob") continue;
    entries.push({
      path: line.slice(tab + 1),
      blobSha,
      sizeBytes: Number(size) || 0,
    });
  }
  return entries;
}

export async function readFileAt(
  slug: string,
  sha: string,
  path: string,
): Promise<string> {
  try {
    return await git(repoDir(slug), ["show", `${sha}:${path}`]);
  } catch {
    throw notFound(
      `'${path}' not found in repo '${slug}' at ${sha.slice(0, 12)}`,
    );
  }
}

export async function removeClone(slug: string): Promise<void> {
  await rm(repoDir(slug), { recursive: true, force: true });
}
