import { sql } from "../infra/db";
import type { CoverageCounts, CoverageNode, Coverage } from "@tachy/contract";

export type { CoverageCounts, CoverageNode, Coverage };

const zero = (): CoverageCounts => ({
  entries: 0,
  docs: 0,
  articles: 0,
  reads: 0,
});

/**
 * Which parts of a product have lessons recorded and nothing written about them.
 * A report over the component tree — deliberately not the wiki's navigation,
 * which is its categories.
 *
 * Counts are computed per component and rolled up in memory rather than with a
 * recursive CTE: a product's component tree is tens of rows, and the rollup is
 * clearer written once than expressed twice in SQL.
 */
export async function coverage(productId: string): Promise<Coverage> {
  const [components, counts, reads, unfiled] = await Promise.all([
    sql<Pick<CoverageNode, "id" | "parent_id" | "slug" | "name">[]>`
      select id, parent_id, slug, name
      from components where product_id = ${productId}
      order by slug
    `,
    // One subquery per count rather than two left joins: joining entries and
    // docs onto the same component multiplies them, entries × docs rows per
    // component, for count(distinct) to throw away again.
    sql<({ id: string } & Omit<CoverageCounts, "reads">)[]>`
      select c.id,
             (select count(*)::int from knowledge_entries e
               where e.component_id = c.id and e.status <> 'archived') as entries,
             (select count(*)::int from reference_docs d
               where d.component_id = c.id and d.status <> 'archived'
                 and d.kind = 'reference') as docs,
             (select count(*)::int from reference_docs d
               where d.component_id = c.id and d.status <> 'archived'
                 and d.kind = 'wiki') as articles
      from components c
      where c.product_id = ${productId}
    `,
    // Read volume follows the item to whichever component it is anchored to.
    sql<{ component_id: string; reads: number }[]>`
      select coalesce(e.component_id, d.component_id) as component_id,
             coalesce(sum(v.views), 0)::int as reads
      from library_views v
      left join knowledge_entries e on e.id = v.knowledge_entry_id
      left join reference_docs d    on d.id = v.reference_doc_id
      where coalesce(e.component_id, d.component_id) is not null
        and coalesce(e.product_id, d.product_id) = ${productId}
      group by 1
    `,
    sql<Coverage["unfiled"][]>`
      select
        (select count(*)::int from knowledge_entries
          where product_id = ${productId} and component_id is null
            and status <> 'archived') as entries,
        (select count(*)::int from reference_docs
          where product_id = ${productId} and component_id is null
            and kind = 'reference' and status <> 'archived') as docs,
        (select count(*)::int from reference_docs
          where product_id = ${productId} and component_id is null
            and kind = 'wiki' and status <> 'archived') as articles
    `,
  ]);

  const countBy = new Map<string, CoverageCounts>();
  for (const r of counts)
    countBy.set(r.id, {
      entries: r.entries,
      docs: r.docs,
      articles: r.articles,
      reads: 0,
    });
  for (const r of reads) {
    const c = countBy.get(r.component_id);
    if (c) c.reads = r.reads;
  }

  const nodes = new Map<string, CoverageNode>();
  for (const c of components)
    nodes.set(c.id, {
      id: c.id,
      parent_id: c.parent_id,
      slug: c.slug,
      name: c.name,
      ...(countBy.get(c.id) ?? zero()),
      subtree: zero(),
      children: [],
    });

  const roots: CoverageNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  // Post-order, so a child's subtree is complete before its parent reads it and
  // every node is counted exactly once.
  const roll = (n: CoverageNode): CoverageCounts => {
    n.subtree = {
      entries: n.entries,
      docs: n.docs,
      articles: n.articles,
      reads: n.reads,
    };
    for (const child of n.children) {
      const s = roll(child);
      n.subtree.entries += s.entries;
      n.subtree.docs += s.docs;
      n.subtree.articles += s.articles;
      n.subtree.reads += s.reads;
    }
    return n.subtree;
  };
  for (const r of roots) roll(r);

  return { nodes: roots, unfiled: unfiled[0] };
}
