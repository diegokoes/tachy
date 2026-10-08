import { hasJobKind, getJobKind } from "./registry";

const NUMBER = new Intl.NumberFormat("en-US");

export const num = (n: number) => NUMBER.format(n);

/** "1 item", "2,507 items". */
export function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${num(n)} ${n === 1 ? noun : plural}`;
}

/**
 * One line for the output of a kind that did not write its own: numbers as
 * `3 keys words`, zeros and non-scalars left out.
 */
export function genericOutcome(output: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(output)) {
    const words = key.replaceAll("_", " ");
    if (typeof value === "number") {
      if (value) parts.push(`${num(value)} ${words}`);
    } else if (typeof value === "string") {
      if (value) parts.push(`${words} ${value}`);
    } else if (typeof value === "boolean") {
      if (value) parts.push(words);
    }
  }
  return parts.length ? parts.join(", ") : null;
}

export const kindTitle = (kind: string) =>
  hasJobKind(kind) ? getJobKind(kind).title : kind;

/** What a run is about, and how it ended, in the words the admin reads. */
export function presentRun(
  kind: string,
  params: Record<string, unknown>,
  output: Record<string, unknown> | null,
): { subject: string | null; outcome: string | null } {
  if (!hasJobKind(kind)) return { subject: null, outcome: null };
  const known = getJobKind(kind);
  const safe = <T>(render: () => T): T | null => {
    try {
      return render();
    } catch {
      return null;
    }
  };
  return {
    subject: known.subject ? safe(() => known.subject!(params)) : null,
    outcome: output
      ? safe(() =>
          known.outcome ? known.outcome(output) : genericOutcome(output),
        )
      : null,
  };
}
