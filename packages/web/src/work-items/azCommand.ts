import type { ComposerProject } from "@tachy/contract";

/** Where the `/az` line is, for the menu to offer the next thing to pick. */
export type AzStage =
  | { stage: "sub"; query: string }
  | { stage: "project"; query: string }
  | { stage: "type"; project: ComposerProject; query: string };

const startsWithWord = (text: string, word: string) =>
  text.toLowerCase().startsWith(`${word.toLowerCase()} `);

/**
 * A project is matched by name or ADO key rather than by splitting on spaces,
 * because ADO project names have spaces in them. The longest match wins, so
 * "Portal" never shadows "Portal Mobile".
 */
export function matchProject(
  text: string,
  projects: readonly ComposerProject[],
): { project: ComposerProject; rest: string } | null {
  let best: { project: ComposerProject; label: string } | null = null;
  for (const p of projects)
    for (const label of [p.name, p.external_key])
      if (
        startsWithWord(text, label) &&
        (!best || label.length > best.label.length)
      )
        best = { project: p, label };
  return best
    ? { project: best.project, rest: text.slice(best.label.length + 1).trim() }
    : null;
}

/** Null when the line is not an `/az` argument being typed. */
export function parseAz(
  input: string,
  projects: readonly ComposerProject[],
): AzStage | null {
  const m = input.match(/^\/az[ \t]+([^\n]*)$/);
  if (!m) return null;
  const rest = m[1];
  const sub = rest.match(/^([a-z-]*)$/);
  if (sub) return { stage: "sub", query: sub[1] };
  const after = rest.match(/^new[ \t]+(.*)$/);
  if (!after) return null;
  const hit = matchProject(after[1], projects);
  return hit
    ? { stage: "type", project: hit.project, query: hit.rest }
    : { stage: "project", query: after[1] };
}

/** `/az new …` as sent: the composer opens instead of a turn starting. */
export const isAzNew = (message: string) => /^\/az[ \t]+new\b/.test(message);

export const matches = (query: string, ...texts: (string | null)[]) => {
  const q = query.trim().toLowerCase();
  return !q || texts.some((t) => t?.toLowerCase().includes(q));
};
