import type { NamedRow } from "./types";

/**
 * Components nest arbitrarily deep via `parent_id`, but `/products/:slug/components`
 * returns them flat and slug-ordered — so a sub-component lands next to its
 * parent's siblings and the shape is invisible in a picker. Re-order the flat
 * list depth-first and indent each row by its depth.
 */
export function componentOptions(
  rows: NamedRow[],
): { value: string; label: string }[] {
  const byParent = new Map<string | null, NamedRow[]>();
  for (const r of rows) {
    const parent = (r.parent_id as string | null) ?? null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), r]);
  }

  // A row whose parent is not in this list (filtered, or a stale id) would
  // otherwise vanish; treat it as a root so nothing is silently dropped.
  const ids = new Set(rows.map((r) => r.id as string));
  const roots = rows.filter((r) => {
    const parent = (r.parent_id as string | null) ?? null;
    return parent === null || !ids.has(parent);
  });

  const out: { value: string; label: string }[] = [];
  const walk = (row: NamedRow, depth: number) => {
    const slug = row.slug as string;
    out.push({
      value: slug,
      label: depth ? `${" ".repeat(depth * 2)}↳ ${slug}` : slug,
    });
    for (const child of byParent.get(row.id as string) ?? [])
      walk(child, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}
