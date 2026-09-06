import { sql } from "./db";

/**
 * Self-parenting tables. Named rather than taken as a string so the identifier
 * that reaches the query is one of these three and nothing else — the same
 * shape `resolveScoped` uses for its own table argument.
 */
const HIERARCHY_TABLES = [
  "components",
  "customer_units",
  "wiki_categories",
] as const;
export type HierarchyTable = (typeof HIERARCHY_TABLES)[number];

/**
 * Deep enough for any real tree, and the reason the walk terminates at all: if
 * a ring already exists — written before these checks did — an uncapped
 * recursive CTE does not return, and this runs on the save path.
 */
const MAX_DEPTH = 64;

/**
 * The columns that point at another row of the same table. `customer_units` has
 * two — where a unit sits, and which unit it takes its shape from — and both can
 * ring.
 */
const PARENT_COLUMNS = ["parent_id", "profile_id"] as const;
export type ParentColumn = (typeof PARENT_COLUMNS)[number];

/**
 * Would pointing `childId` at `parentId` close a ring? Answered by walking up
 * from the proposed parent and looking for the child, which is the only
 * direction that can reach it.
 */
export async function wouldCycle(
  table: HierarchyTable,
  childId: string,
  parentId: string | null,
  column: ParentColumn = "parent_id",
): Promise<boolean> {
  if (!parentId || parentId === childId) return parentId === childId;
  const [{ hits }] = await sql`
    with recursive up as (
      select id, ${sql(column)} as next, 1 as depth
      from ${sql(table)} where id = ${parentId}
      union all
      select t.id, t.${sql(column)}, up.depth + 1
      from ${sql(table)} t join up on t.id = up.next
      where up.depth < ${MAX_DEPTH}
    )
    select count(*)::int as hits from up where id = ${childId}
  `;
  return (hits as number) > 0;
}
