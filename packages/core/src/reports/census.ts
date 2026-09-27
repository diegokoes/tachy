import { sql } from "../infra/db";
import type { ReportsCensus } from "@tachy/contract";

/**
 * The queue at a glance for the System overview: how many are waiting, how the
 * open ones split by type, and how long the oldest has sat unanswered.
 */
export async function reportsCensus(): Promise<ReportsCensus> {
  const [row] = await sql<ReportsCensus[]>`
    select
      (select count(*)::int from reports) as reports,
      (select count(*)::int from reports where status = 'open') as open,
      (select count(*)::int from reports where status = 'in_progress')
        as in_progress,
      (select count(*)::int from reports where status = 'resolved') as resolved,
      (select count(*)::int from reports where type = 'bug') as bugs,
      (select count(*)::int from reports where type = 'feature') as features,
      (select min(created_at) from reports where status = 'open')
        as oldest_open_at
  `;
  return row;
}
