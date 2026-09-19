import type { ComponentRow } from "@tachy/contract";

/**
 * Components nest arbitrarily deep via `parent_id`, but `/products/:slug/components`
 * returns them flat and slug-ordered — so a sub-component lands next to its
 * parent's siblings and the shape is invisible in a picker. Re-order the flat
 * list depth-first and indent each row by its depth.
 */
export function componentOptions(
  rows: Pick<ComponentRow, "id" | "slug" | "parent_id">[],
): { value: string; label: string }[] {
  type Row = (typeof rows)[number];
  const byParent = new Map<string | null, Row[]>();
  for (const r of rows) {
    byParent.set(r.parent_id, [...(byParent.get(r.parent_id) ?? []), r]);
  }

  // A row whose parent is not in this list (filtered, or a stale id) would
  // otherwise vanish; treat it as a root so nothing is silently dropped.
  const ids = new Set(rows.map((r) => r.id));
  const roots = rows.filter(
    (r) => r.parent_id === null || !ids.has(r.parent_id),
  );

  const out: { value: string; label: string }[] = [];
  const walk = (row: Row, depth: number) => {
    out.push({
      value: row.slug,
      label: depth ? `${" ".repeat(depth * 2)}↳ ${row.slug}` : row.slug,
    });
    for (const child of byParent.get(row.id) ?? []) walk(child, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}
