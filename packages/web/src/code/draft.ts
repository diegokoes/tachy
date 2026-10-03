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

export function draftOf(r: Repo): RepoDraft {
  return {
    url: r.url,
    source_project_id: r.source_project_id ?? "",
    product_slug: r.source_project_id ? "" : (r.product_slug ?? ""),
    customer_slug: r.customer_slug ?? "",
    component_slug: r.component_slug ?? "",
    default_branch: r.default_branch,
    lines: r.lines.map((l) => l.ref).filter((ref) => ref !== r.default_branch),
    exclude: strings(r.config?.exclude) ?? [],
    extensions: strings(r.config?.include_extensions),
    max_file_kb:
      r.config?.max_file_kb == null ? "" : String(r.config.max_file_kb),
  };
}

export function configOf(d: RepoDraft): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (d.extensions) config.include_extensions = d.extensions;
  if (d.max_file_kb.trim()) config.max_file_kb = Number(d.max_file_kb);
  if (d.exclude.length) config.exclude = d.exclude;
  return config;
}

/** Writes a repo; `product` is the one it is scoped by when it has no project. */
export function saveRepo(slug: string, d: RepoDraft, product: string) {
  return api.put("/repos", {
    slug,
    url: d.url.trim(),
    ...(d.source_project_id ? { source_project_id: d.source_project_id } : {}),
    ...(product ? { product } : {}),
    component: d.component_slug || null,
    customer: d.customer_slug || null,
    branch: d.default_branch.trim() || "main",
    lines: d.lines,
    config: configOf(d),
  });
}

const GLOB_CHARS_RE = /[*?[{]/;

/** Globs are typed; plain paths are what the folder tree toggles. */
export const isGlob = (pattern: string) => GLOB_CHARS_RE.test(pattern);
