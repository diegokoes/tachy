const MAINLINE = ["master", "main", "develop", "quality"];
const RELEASE_LINE_RE = /^(legacy|release)\//;

const MAINLINE_RANK = 0;
const RELEASE_RANK = 1;
const OTHER_RANK = 2;

export const branchRank = (b: string) => {
  if (MAINLINE.includes(b)) return MAINLINE_RANK;
  return RELEASE_LINE_RE.test(b) ? RELEASE_RANK : OTHER_RANK;
};

/** Mainline in its usual order, then release lines newest first, then the rest. */
export const byBranch = (a: string, b: string) => {
  const rank = branchRank(a);
  if (rank !== branchRank(b)) return rank - branchRank(b);
  if (rank === MAINLINE_RANK) return MAINLINE.indexOf(a) - MAINLINE.indexOf(b);
  if (rank === RELEASE_RANK)
    return b.localeCompare(a, undefined, { numeric: true });
  return a.localeCompare(b);
};

/** Branches worth offering as extra lines: mainline and release lines, plus any already tracked. */
export function lineCandidates(
  branches: string[],
  tracked: string[],
  defaultBranch: string,
): string[] {
  const offered = branches.filter((b) => branchRank(b) < OTHER_RANK);
  return [...new Set([...tracked, ...offered])]
    .filter((b) => b !== defaultBranch)
    .sort(byBranch);
}

export type Refs = { branches: string[]; releases: string[] };

const URLISH_RE = /^(https?:\/\/|ssh:\/\/|git@)\S+$/;

/** Whether a clone URL is complete enough to ask the remote about. */
export const isUrlish = (url: string) => URLISH_RE.test(url);
