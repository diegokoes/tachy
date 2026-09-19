type Branch<T> = { slug: string; children: T[] };

/** Every node depth-first, with its depth, for pickers that indent. */
export function flattenTree<T extends Branch<T>>(
  nodes: T[],
  depth = 0,
): { n: T; depth: number }[] {
  return nodes.flatMap((n) => [
    { n, depth },
    ...flattenTree(n.children, depth + 1),
  ]);
}

/** A node and all its descendants: the parents it cannot be moved under. */
export function subtreeSlugs<T extends Branch<T>>(n: T): string[] {
  return [n.slug, ...n.children.flatMap(subtreeSlugs)];
}
