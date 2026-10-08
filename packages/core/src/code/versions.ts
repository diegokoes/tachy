import { normalizeVersion, releaseMinor } from "@tachy/contract";
import { sql } from "../infra/db";
import { badInput, notFound } from "../infra/errors";
import {
  branchContains,
  changedFiles,
  commitSummary,
  diffBetween,
  logBetween,
  parentOf,
  releasesContaining,
  resolveCommit,
  resolveRef,
  type ChangedFile,
  type CommitSummary,
} from "./git";
import { getRepoBySlug } from "./repos";

export interface ResolvedVersion {
  version: string;
  /** The release tag, when the repo has one for exactly this version. */
  tag: string | null;
  commit: string | null;
  /** The tracked line this version belongs to, else the default line. */
  line: { ref: string; version_label: string | null };
  /**
   * False when no tracked line is on this version's minor and the default stood
   * in.
   */
  line_matches: boolean;
}

/**
 * Where a version lives in a repo: its release tag (`v1.51.32` or `1.51.32`)
 * for reading code exactly as released, and the tracked line on the same minor
 * for searching the code that line has moved on to since.
 */
export async function resolveVersion(
  slug: string,
  version: string,
): Promise<ResolvedVersion> {
  const normalized = normalizeVersion(version);
  if (!normalized)
    throw badInput(
      `'${version}' is not a version; expected major.minor or major.minor.patch`,
    );
  const repo = await getRepoBySlug(slug);
  const minor = releaseMinor(normalized);
  const onMinor = repo.lines.find(
    (l) => l.version_label && releaseMinor(l.version_label) === minor,
  );
  const line = onMinor ?? repo.lines[0];
  if (!line) throw notFound(`Repo '${slug}' has no tracked line`);

  let tag: string | null = null;
  let commit: string | null = null;
  if (normalized.split(".").length === 3)
    for (const candidate of [`v${normalized}`, normalized]) {
      commit = await resolveRef(slug, `refs/tags/${candidate}`);
      if (commit) {
        tag = candidate;
        break;
      }
    }
  return {
    version: normalized,
    tag,
    commit,
    line: { ref: line.ref, version_label: line.version_label },
    line_matches: Boolean(onMinor),
  };
}

const WORK_ITEM_REF_RE = /(?:AB)?#(\d{2,9})\b/g;

export interface CodeChanges {
  from: string;
  to: string;
  commits: CommitSummary[];
  truncated: boolean;
  /** `#123` references in the messages that match an archived work item. */
  work_items: {
    id: string;
    external_id: string;
    title: string | null;
    status: string | null;
    fixed_versions: string[];
  }[];
}

/**
 * The commits between two versions of a repo, optionally under one path, with
 * the archived work items their messages name. From a customer's version to a
 * later one, that is what shipped since, and whether the fix did.
 */
export async function codeChangesBetween(
  slug: string,
  fromVersion: string,
  toVersion?: string,
  opts: { path?: string; limit?: number } = {},
): Promise<CodeChanges> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const from = await resolveVersion(slug, fromVersion);
  if (!from.tag)
    throw notFound(`Repo '${slug}' has no release tag for ${from.version}`);

  let toRev: string;
  if (toVersion) {
    const to = await resolveVersion(slug, toVersion);
    if (!to.tag)
      throw notFound(`Repo '${slug}' has no release tag for ${to.version}`);
    toRev = to.tag;
  } else {
    toRev = from.line.ref;
  }
  const toRef = toVersion ? `refs/tags/${toRev}` : `refs/heads/${toRev}`;
  if (!(await resolveRef(slug, toRef)))
    throw notFound(`Repo '${slug}' has no '${toRev}' fetched yet; reindex it`);

  const commits = await logBetween(slug, `refs/tags/${from.tag}`, toRef, {
    path: opts.path,
    limit: limit + 1,
  });
  const truncated = commits.length > limit;
  const shown = commits.slice(0, limit);

  const refs = [
    ...new Set(
      shown.flatMap((c) =>
        [...c.subject.matchAll(WORK_ITEM_REF_RE)].map((m) => m[1]),
      ),
    ),
  ];
  const repo = await getRepoBySlug(slug);
  const workItems =
    refs.length && repo.source_slug
      ? await sql<CodeChanges["work_items"]>`
          select w.id, w.external_id, w.title, w.status,
                 coalesce(array_agg(distinct k.fixed_version)
                   filter (where k.fixed_version is not null), '{}') as fixed_versions
          from work_items w
          join source_connections sc on sc.id = w.source_connection_id
          left join knowledge_entries k on k.work_item_id = w.id
          where sc.slug = ${repo.source_slug} and w.external_id = any(${refs})
          group by w.id
          order by w.external_id
        `
      : [];
  return {
    from: from.tag,
    to: toRev,
    commits: shown,
    truncated,
    work_items: workItems,
  };
}

/**
 * The commit a revision names: a commit id or an abbreviation of it, a release
 * version, or a branch or tag the clone has.
 */
export async function resolveRevision(
  slug: string,
  revision: string,
): Promise<string> {
  const byId = await resolveCommit(slug, revision);
  if (byId) return byId;
  if (normalizeVersion(revision)?.split(".").length === 3) {
    const resolved = await resolveVersion(slug, revision);
    if (resolved.commit) return resolved.commit;
  }
  const byRef =
    (await resolveRef(slug, `refs/heads/${revision}`)) ??
    (await resolveRef(slug, `refs/tags/${revision}`));
  if (byRef) return byRef;
  throw notFound(
    `Repo '${slug}' has no commit, release, branch or tag '${revision}' fetched`,
  );
}

/** Files past this, a diff lists what changed and leaves the patch out. */
const MAX_DIFF_FILES = 40;
const MAX_PATCH_LINES = 600;
const MAX_PATCH_BYTES = 64 * 1024;

export interface CodeDiff {
  repo: string;
  from: string;
  to: string;
  /** Set when the diff is of one commit against its parent. */
  commit?: CommitSummary;
  files: ChangedFile[];
  /** Null when there are too many files to read without a `path`. */
  patch: string | null;
  truncated: boolean;
}

export interface CodeDiffRange {
  /** One commit, against its first parent. */
  commit?: string;
  from?: string;
  to?: string;
  /** Only changes to this file or directory. */
  path?: string;
  /** Fetches the file contents a partial clone does not hold yet. */
  token?: string;
}

/**
 * What one commit changed, or what differs between two revisions. The file
 * list comes from trees alone; the patch is read only when the list is short
 * enough, since every file in it is fetched from the remote.
 */
export async function codeDiff(
  slug: string,
  range: CodeDiffRange,
): Promise<CodeDiff> {
  await getRepoBySlug(slug);
  if (!range.commit && !(range.from && range.to))
    throw badInput("code_diff needs a commit, or both from and to");

  const to = await resolveRevision(slug, range.commit ?? range.to!);
  const from = range.commit
    ? await parentOf(slug, to)
    : await resolveRevision(slug, range.from!);
  const files = await changedFiles(slug, from, to, range.path);
  const base = {
    repo: slug,
    from,
    to,
    ...(range.commit ? { commit: await commitSummary(slug, to) } : {}),
    files,
  };
  if (files.length > MAX_DIFF_FILES)
    return { ...base, patch: null, truncated: true };

  const patch = await diffBetween(slug, from, to, {
    path: range.path,
    token: range.token,
  });
  const kept = patch
    .slice(0, MAX_PATCH_BYTES)
    .split("\n")
    .slice(0, MAX_PATCH_LINES)
    .join("\n");
  return { ...base, patch: kept, truncated: kept.length < patch.length };
}

export interface ReleasesContaining {
  repo: string;
  commit: CommitSummary;
  /** The oldest release holding the commit; null when none does yet. */
  first_release: string | null;
  /** The oldest release holding it on each minor, oldest minor first. */
  first_per_minor: string[];
  /** Each tracked line, and whether its head holds the commit. */
  lines: { ref: string; contains: boolean }[];
}

/**
 * The releases a commit shipped in. A fix is in a customer's install when
 * their version is at or past the first release on their minor.
 */
export async function codeReleasesContaining(
  slug: string,
  commit: string,
): Promise<ReleasesContaining> {
  const repo = await getRepoBySlug(slug);
  const sha = await resolveCommit(slug, commit);
  if (!sha) throw notFound(`Repo '${slug}' has no commit '${commit}' fetched`);
  const releases = await releasesContaining(slug, sha);
  const firstPerMinor = new Map<string, string>();
  for (const tag of releases) {
    const minor = releaseMinor(tag)!;
    if (!firstPerMinor.has(minor)) firstPerMinor.set(minor, tag);
  }
  return {
    repo: slug,
    commit: await commitSummary(slug, sha),
    first_release: releases[0] ?? null,
    first_per_minor: [...firstPerMinor.values()],
    lines: await Promise.all(
      repo.lines.map(async (l) => ({
        ref: l.ref,
        contains: await branchContains(slug, l.ref, sha),
      })),
    ),
  };
}
