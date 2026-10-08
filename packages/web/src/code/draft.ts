import { api } from "../api";
import type { Repo } from "./rows";

/** A repo's settings as the repo page edits them. */
export type RepoDraft = {
  url: string;
  source_project_id: string;
  product_slug: string;
  customer_slug: string;
  component_slug: string;
  default_branch: string;
  /** Tracked besides the default branch. */
  lines: string[];
  exclude: string[];
  /** Null indexes the built-in set. */
  extensions: string[] | null;
  max_file_kb: string;
};

const strings = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.map(String) : null;

export function draftOf(repo: Repo): RepoDraft {
  return {
    url: repo.url,
    source_project_id: repo.source_project_id ?? "",
    product_slug: repo.source_project_id ? "" : (repo.product_slug ?? ""),
    customer_slug: repo.customer_slug ?? "",
    component_slug: repo.component_slug ?? "",
    default_branch: repo.default_branch,
    lines: repo.lines
      .map((l) => l.ref)
      .filter((ref) => ref !== repo.default_branch),
    exclude: strings(repo.config?.exclude) ?? [],
    extensions: strings(repo.config?.include_extensions),
    max_file_kb:
      repo.config?.max_file_kb == null ? "" : String(repo.config.max_file_kb),
  };
}

export function configOf(draft: RepoDraft): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (draft.extensions) config.include_extensions = draft.extensions;
  if (draft.max_file_kb.trim()) config.max_file_kb = Number(draft.max_file_kb);
  if (draft.exclude.length) config.exclude = draft.exclude;
  return config;
}

/** Writes a repo; `product` is the one it is scoped by when it has no project. */
export function saveRepo(slug: string, draft: RepoDraft, product: string) {
  return api.put("/repos", {
    slug,
    url: draft.url.trim(),
    ...(draft.source_project_id
      ? { source_project_id: draft.source_project_id }
      : {}),
    ...(product ? { product } : {}),
    component: draft.component_slug || null,
    customer: draft.customer_slug || null,
    branch: draft.default_branch.trim() || "main",
    lines: draft.lines,
    config: configOf(draft),
  });
}

const GLOB_CHARS_RE = /[*?[{]/;

/** Globs are typed; plain paths are what the folder tree toggles. */
export const isGlob = (pattern: string) => GLOB_CHARS_RE.test(pattern);
