import { normalizeVersion, releaseMinor } from "@tachy/contract";
import { sql } from "../infra/db";
import { badInput, notFound } from "../infra/errors";
import { logBetween, resolveRef, type CommitSummary } from "./git";
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
  const v = normalizeVersion(version);
  if (!v)
    throw badInput(
      `'${version}' is not a version; expected major.minor or major.minor.patch`,
    );
  const repo = await getRepoBySlug(slug);
  const minor = releaseMinor(v);
  const onMinor = repo.lines.find(
    (l) => l.version_label && releaseMinor(l.version_label) === minor,
  );
  const line = onMinor ?? repo.lines[0];
  if (!line) throw notFound(`Repo '${slug}' has no tracked line`);

  let tag: string | null = null;
  let commit: string | null = null;
  if (v.split(".").length === 3)
    for (const candidate of [`v${v}`, v]) {
      commit = await resolveRef(slug, `refs/tags/${candidate}`);
      if (commit) {
        tag = candidate;
        break;
      }
    }
  return {
    version: v,
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
