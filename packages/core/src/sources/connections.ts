import type { SourceCensus, SourceConnectionRow } from "@tachy/contract";
import { sql, jsonb } from "../infra/db";
import { ISSUE_ITEMS, issueList, type IssueList } from "../infra/issues";
import { badInput, notFound } from "../infra/errors";
import { addSourceProject, deleteSourceProject } from "./projects";

export interface SourceConnectionInput {
  sourceType: string;
  slug: string;
  baseUrl?: string;
  config?: Record<string, unknown>;
}

export async function listSourceConnections() {
  return sql<
    SourceConnectionRow[]
  >`select id, source_type, slug, base_url, config from source_connections order by slug`;
}

export async function addSourceConnection(i: SourceConnectionInput) {
  const [row] = await sql`
    insert into source_connections (source_type, slug, base_url, config)
    values (${i.sourceType}, ${i.slug}, ${i.baseUrl ?? null}, ${jsonb(i.config ?? {})})
    on conflict (slug) do update set
      source_type = excluded.source_type,
      base_url    = excluded.base_url,
      config      = excluded.config
    returning id, source_type, slug, base_url, config
  `;
  return row;
}

/**
 * Deleting cascades to work items and their knowledge entries, so this refuses
 * while any item is still ingested — the caller must clear them deliberately.
 * The connection's stored API tokens go with it, at every scope.
 */
export async function deleteSourceConnection(slug: string) {
  const [conn] =
    await sql`select id, source_type from source_connections where slug = ${slug}`;
  if (!conn) throw notFound(`Source connection '${slug}' not found`);
  const [{ count }] = await sql`
    select count(*)::int as count from work_items where source_connection_id = ${conn.id}
  `;
  if (count > 0)
    throw badInput(
      `Source connection '${slug}' still has ${count} ingested work item(s). Delete those first; removing the connection cascades to them.`,
    );
  await sql`delete from credentials where name = ${`${conn.source_type}_token:${slug}`}`;
  await sql`delete from source_connections where id = ${conn.id}`;
  return { deleted: true, slug };
}

/**
 * For the admin index: how much this domain holds, and what is not finished.
 *
 * A knowledge project always has a product — source_projects carries a check
 * constraint saying so — which is why there is no count of productless ones.
 */
export async function sourceCensus(): Promise<SourceCensus> {
  const [row] = await sql<Omit<SourceCensus, "by_type">[]>`
    select
      (select count(*)::int from source_connections) as connections,
      (select count(*)::int from source_projects) as projects,
      (select count(*)::int from source_projects where role = 'knowledge') as knowledge,
      (select count(*)::int from source_projects where role = 'tracker') as trackers,
      (select count(*)::int from source_projects
        where role = 'knowledge' and jsonb_array_length(wikis) = 0) as projects_no_wiki,
      (select count(*)::int from source_projects where customer_id is not null)
        as projects_for_customer,
      (select count(*)::int from source_connections where last_synced_at is null)
        as never_synced
  `;
  const kinds = await sql<{ source_type: string; n: number }[]>`
    select source_type, count(*)::int as n
    from source_connections
    group by source_type
    order by n desc, source_type
  `;
  return {
    ...row,
    by_type: Object.fromEntries(kinds.map((k) => [k.source_type, k.n])),
  };
}

/**
 * Connections and projects that are not finished, by name. Missing tokens are
 * not here: whether a token resolves depends on the caller's scope and the
 * environment, so the route asks the resolver instead of the vault.
 */
export async function sourceIssues(
  days = 14,
): Promise<Record<string, IssueList>> {
  const [neverSynced, refusing, noWiki] = await Promise.all([
    sql`
      select slug as key, slug as label, count(*) over () as total
      from source_connections where last_synced_at is null
      order by slug limit ${ISSUE_ITEMS}
    `,
    sql`
      select c.slug as key, c.slug as label, count(*) over () as total
      from source_connections c
      where exists (
        select 1 from source_calls s
        where s.source_connection_id = c.id and s.auth_failures > 0
          and s.day > current_date - ${days}::int
      )
      order by c.slug limit ${ISSUE_ITEMS}
    `,
    sql`
      select id as key, name as label, count(*) over () as total
      from source_projects
      where role = 'knowledge' and jsonb_array_length(wikis) = 0
      order by name limit ${ISSUE_ITEMS}
    `,
  ]);
  return {
    "sources.refusing": issueList(refusing),
    "sources.never_synced": issueList(neverSynced),
    "projects.no_wiki": issueList(noWiki),
  };
}
