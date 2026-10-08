import { api } from "../api";
import type { Repo } from "./rows";

/** What the `/code` scope menu offers, fetched the first time it opens. */
export const codeScope = $state({
  repos: null as Repo[] | null,
  error: null as string | null,
});

let reposCall: Promise<Repo[]> | null = null;

export function ensureRepos(): Promise<Repo[]> {
  if (codeScope.repos) return Promise.resolve(codeScope.repos);
  reposCall ??= api
    .get<{ repos: Repo[] }>("/repos")
    .then((r) => (codeScope.repos = r.repos))
    .catch((e) => {
      codeScope.error = e instanceof Error ? e.message : String(e);
      reposCall = null;
      return [];
    });
  return reposCall;
}

/** Why the scope list is empty, for the menu to say instead of rows. */
export function scopeNote(): string {
  if (codeScope.error) return codeScope.error;
  if (!codeScope.repos) return "loading repos…";
  return codeScope.repos.length
    ? "no repo or project matches"
    : "no repository is linked yet";
}
