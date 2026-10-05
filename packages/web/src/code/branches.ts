const MAINLINE = ["master", "main", "develop", "quality"];
const RELEASE_LINE_RE = /^(legacy|release)\//;

export const branchRank = (b: string) =>
  MAINLINE.includes(b) ? 0 : RELEASE_LINE_RE.test(b) ? 1 : 2;

/** Mainline in its usual order, then release lines newest first, then the rest. */
export const byBranch = (a: string, b: string) =>
  branchRank(a) - branchRank(b) ||
  (branchRank(a) === 0
    ? MAINLINE.indexOf(a) - MAINLINE.indexOf(b)
    : branchRank(a) === 1
      ? b.localeCompare(a, undefined, { numeric: true })
      : a.localeCompare(b));

/** Branches worth offering as extra lines: mainline and release lines, plus any already tracked. */
export function lineCandidates(
  branches: string[],
  tracked: string[],
  defaultBranch: string,
): string[] {
  const offered = branches.filter((b) => branchRank(b) < 2);
  return [...new Set([...tracked, ...offered])]
    .filter((b) => b !== defaultBranch)
    .sort(byBranch);
}

export type Refs = { branches: string[]; releases: string[] };

const URLISH_RE = /^(https?:\/\/|ssh:\/\/|git@)\S+$/;

/** Whether a clone URL is complete enough to ask the remote about. */
export const isUrlish = (url: string) => URLISH_RE.test(url);
