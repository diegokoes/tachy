import type { Block } from "../tui";
import type { ComponentCoverage } from "./rows";

/** The last key segment of a component's own entries, beside its children's. */
export const OWN = "~own";

type Built = { block: Block; entries: number; components: number };

function tip(trail: string, b: Omit<Built, "block"> & { searchable: number }) {
  const across = b.components > 1 ? ` across ${b.components} components` : "";
  return `${trail}: ${b.searchable} searchable of ${b.entries} entries${across}`;
}

function group(
  key: string,
  label: string,
  trail: string,
  parts: Built[],
): Built {
  const entries = parts.reduce((n, p) => n + p.entries, 0);
  const components = parts.reduce((n, p) => n + p.components, 0);
  const searchable = parts.reduce((n, p) => n + p.block.value, 0);
  return {
    block: {
      key,
      label,
      value: searchable,
      title: tip(trail, { entries, components, searchable }),
      children: parts.map((p) => p.block),
    },
    entries,
    components,
  };
}

/**
 * The component tree as treemap blocks: products, then components nested by
 * parent. Every component is one leaf of area, so a product's area is its
 * component count and a leaf's heat its searchable entries; a component with
 * children keeps its own entries as a leaf beside theirs. Keys are `product`
 * and `product/component`, which is also the zoom's path.
 */
export function coverageTree(rows: ComponentCoverage[], label: string): Block {
  const ids = new Set(rows.map((r) => r.id));
  const under = new Map<string, ComponentCoverage[]>();
  const products = new Map<string, ComponentCoverage[]>();
  for (const row of rows) {
    const [into, at] =
      row.parent_id && ids.has(row.parent_id)
        ? [under, row.parent_id]
        : [products, row.product_slug];
    into.set(at, [...(into.get(at) ?? []), row]);
  }

  const build = (c: ComponentCoverage, trail: string): Built => {
    const key = `${c.product_slug}/${c.slug}`;
    const path = `${trail} › ${c.name}`;
    const kids = under.get(c.id) ?? [];
    const one = { entries: c.entries, components: 1, searchable: c.searchable };
    const own: Built = {
      block: {
        key: kids.length ? `${key}/${OWN}` : key,
        label: c.name,
        value: c.searchable,
        title: tip(kids.length ? `${path} itself` : path, one),
      },
      entries: c.entries,
      components: 1,
    };
    if (!kids.length) return own;
    return group(key, c.name, path, [own, ...kids.map((k) => build(k, path))]);
  };

  const parts = [...products.values()].map((roots) => {
    const name = roots[0].product_name;
    return group(
      roots[0].product_slug,
      name,
      name,
      roots.map((r) => build(r, name)),
    );
  });
  return group("", label, label, parts).block;
}

/**
 * The groups from the root down to the one keyed `key`, both ends included. A
 * leaf's key lands on the group holding it, and a key that matches nothing on
 * the root, which is where a stale link ends up.
 */
export function trailTo(root: Block, key: string): Block[] {
  const walk = (block: Block): Block[] | null => {
    if (block.key === key) return [block];
    for (const child of block.children ?? []) {
      const found = walk(child);
      if (found) return [block, ...found];
    }
    return null;
  };
  const found = (key && walk(root)) || [root];
  return found.length > 1 && !found.at(-1)?.children?.length
    ? found.slice(0, -1)
    : found;
}
