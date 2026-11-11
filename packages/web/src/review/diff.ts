export type DiffPart = {
  text: string;
  change: "same" | "added" | "removed";
};

/** Past this many cell comparisons the two sides are shown whole. */
const MAX_COMPARISONS = 4_000_000;

/**
 * Two texts sharing fewer of their words than this are shown as one removal
 * and one addition: a word diff of a rewrite alternates on every "the".
 */
const MIN_SHARED_FRACTION = 0.5;

/** Words and the whitespace between them, so the parts rejoin into the text. */
const tokensOf = (text: string) => text.match(/\s+|\S+/g) ?? [];

const isWord = (token: string) => token.trim() !== "";
const wordCount = (tokens: string[]) => tokens.filter(isWord).length;

const replaced = (before: string[], after: string[]): DiffPart[] =>
  joinRuns([
    ...before.map((text) => ({ text, change: "removed" as const })),
    ...after.map((text) => ({ text, change: "added" as const })),
  ]);

/**
 * The shortest edit from `before` to `after`, as runs of kept, removed and
 * added tokens. Longest common subsequence over the two token lists.
 */
export function diffTokens(before: string[], after: string[]): DiffPart[] {
  if (before.length * after.length > MAX_COMPARISONS)
    return replaced(before, after);

  const width = after.length + 1;
  const common = new Uint32Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      common[i * width + j] =
        before[i] === after[j]
          ? common[(i + 1) * width + j + 1] + 1
          : Math.max(common[(i + 1) * width + j], common[i * width + j + 1]);

  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      parts.push({ text: before[i], change: "same" });
      i++;
      j++;
    } else if (common[(i + 1) * width + j] >= common[i * width + j + 1]) {
      parts.push({ text: before[i++], change: "removed" });
    } else {
      parts.push({ text: after[j++], change: "added" });
    }
  }
  while (i < before.length)
    parts.push({ text: before[i++], change: "removed" });
  while (j < after.length) parts.push({ text: after[j++], change: "added" });

  const words = Math.max(wordCount(before), wordCount(after));
  const sharedWords = parts.filter(
    (part) => part.change === "same" && isWord(part.text),
  ).length;
  if (
    before.length &&
    after.length &&
    sharedWords < words * MIN_SHARED_FRACTION
  )
    return replaced(before, after);
  return joinRuns(parts);
}

function joinRuns(parts: DiffPart[]): DiffPart[] {
  const runs: DiffPart[] = [];
  for (const part of parts) {
    const last = runs.at(-1);
    if (last && last.change === part.change) last.text += part.text;
    else runs.push({ ...part });
  }
  return runs;
}

export const diffWords = (before: string, after: string): DiffPart[] =>
  diffTokens(tokensOf(before), tokensOf(after));

/** One part per list item, in the order a reader of the new list meets them. */
export function diffItems(before: string[], after: string[]): DiffPart[] {
  const kept = new Set(after);
  const had = new Set(before);
  return [
    ...after.map((text) => ({
      text,
      change: had.has(text) ? ("same" as const) : ("added" as const),
    })),
    ...before
      .filter((text) => !kept.has(text))
      .map((text) => ({ text, change: "removed" as const })),
  ];
}
