import { sql } from "../infra/db";

export interface LibraryEngagement {
  days: number;
  reads: number;
  readers: number;
  /** Corrections people filed against entries in the window. */
  corrections: number;
  /** Reads per day, oldest first, gaps filled. */
  per_day: { day: string; reads: number }[];
  /** Most-read items, entries and docs together. */
  top: {
    id: string;
    kind: "entry" | "doc";
    title: string;
    reads: number;
    readers: number;
  }[];
}

/**
 * What people actually read, from `library_views` and `knowledge_feedback`.
 * Human reads only — the agent reads through MCP and never reaches the route
 * that counts a view.
 */
export async function libraryEngagementCensus(
  days = 30,
): Promise<LibraryEngagement> {
  const [totals] = await sql`
    select coalesce(sum(views), 0)::int as reads,
           count(distinct user_id)::int as readers
    from library_views
    where day > current_date - ${days}::int
  `;
  const [feedback] = await sql`
    select count(*)::int as corrections
    from knowledge_feedback
    where kind = 'correction' and created_at > now() - make_interval(days => ${days})
  `;
  const perDayWindow = Math.min(days, 14);
  const per_day = await sql`
    select to_char(d.day, 'YYYY-MM-DD') as day,
           coalesce(sum(v.views), 0)::int as reads
    from generate_series(current_date - ${perDayWindow - 1}::int, current_date, interval '1 day') as d(day)
    left join library_views v on v.day = d.day::date
    group by d.day
    order by d.day
  `;
  const top = await sql`
    select * from (
      select e.id::text as id, 'entry' as kind,
             coalesce(e.issue_summary, 'untitled entry') as title,
             sum(v.views)::int as reads, count(distinct v.user_id)::int as readers
      from library_views v
      join knowledge_entries e on e.id = v.knowledge_entry_id
      where v.day > current_date - ${days}::int
      group by e.id, e.issue_summary
      union all
      select d.id::text, 'doc', d.title,
             sum(v.views)::int, count(distinct v.user_id)::int
      from library_views v
      join reference_docs d on d.id = v.reference_doc_id
      where v.day > current_date - ${days}::int
      group by d.id, d.title
    ) items
    order by reads desc, title
    limit 5
  `;
  return {
    days,
    reads: totals.reads as number,
    readers: totals.readers as number,
    corrections: feedback.corrections as number,
    per_day: [...per_day] as unknown as LibraryEngagement["per_day"],
    top: [...top] as unknown as LibraryEngagement["top"],
  };
}
