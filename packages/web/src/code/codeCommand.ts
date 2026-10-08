import { projectToken } from "@tachy/contract";
import { matches } from "../work-items/azCommand";
import type { Repo } from "./rows";

/** What the `/code` line is waiting for: a scope word being typed, if any. */
export interface CodeStage {
  query: string;
  /** Nothing follows the command yet, so searching everything is on offer. */
  fresh: boolean;
}

/** Null when the line is not a `/code` scope being typed. */
export function parseCode(input: string): CodeStage | null {
  const match = input.match(/^\/code[ \t]+([^\n]*)$/);
  if (!match) return null;
  if (!match[1]) return { query: "", fresh: true };
  const word = match[1].match(/(?:^|\s)@([^\s@]*)$/);
  return word ? { query: word[1], fresh: false } : null;
}

export interface ScopeOption {
  /** The word that goes on the line: `@slug`, or `@token/` for a project. */
  word: string;
  kind: "repo" | "project";
  label: string;
  hint: string;
  desc: string;
}

const repoOption = (repo: Repo): ScopeOption => ({
  word: `@${repo.slug}`,
  kind: "repo",
  label: repo.slug,
  hint: repo.project_key ?? repo.product_slug ?? "",
  desc: [
    repo.component_slug,
    repo.index_status === "ready" ? null : `index ${repo.index_status}`,
  ]
    .filter(Boolean)
    .join(" · "),
});

/** Repos, then the projects they are filed under, narrowed by what is typed. */
export function scopeOptions(
  repos: readonly Repo[],
  query: string,
): ScopeOption[] {
  const perProject = new Map<string, number>();
  for (const repo of repos)
    if (repo.project_key)
      perProject.set(
        repo.project_key,
        (perProject.get(repo.project_key) ?? 0) + 1,
      );
  const projects = [...perProject].map(([key, count]): ScopeOption => ({
    word: `@${projectToken(key)}/`,
    kind: "project",
    label: `${projectToken(key)}/`,
    hint: "project",
    desc: count === 1 ? "1 repo" : `${count} repos`,
  }));
  return [
    ...repos
      .filter((r) => matches(query, r.slug, r.project_key, r.component_slug))
      .map(repoOption),
    ...projects.filter((p) => matches(query, p.label)),
  ];
}

/** The line with the scope word being typed replaced by the one picked. */
export const withScopeWord = (input: string, word: string): string =>
  `${input.replace(/@[^\s@]*$/, "")}${word} `;
