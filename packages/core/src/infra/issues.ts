/** One kind of thing an admin has to fix: how many there are, and the first few by name. */
export interface IssueList {
  n: number;
  items: { key: string; label: string }[];
}

/** How many offenders an issue names before it says "and N more". */
export const ISSUE_ITEMS = 12;

/** From a query selecting `key`, `label` and `count(*) over () as total`, limited to ISSUE_ITEMS. */
export const issueList = (
  rows: readonly Record<string, unknown>[],
): IssueList => ({
  n: Number(rows[0]?.total ?? 0),
  items: rows.map((r) => ({ key: String(r.key), label: String(r.label) })),
});

/** A condition that is either true or not, such as "nobody is an app admin". */
export const issueFlag = (on: boolean): IssueList => ({
  n: on ? 1 : 0,
  items: [],
});
