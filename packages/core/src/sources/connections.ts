import { sql } from "../infra/db";
import { badInput, notFound } from "../infra/errors";
import { addSourceProject, deleteSourceProject } from "./projects";

export interface SourceConnectionInput {
  sourceType: string;
  slug: string;
  baseUrl?: string;
  config?: Record<string, unknown>;
}

export async function listSourceConnections() {
  return sql`select id, source_type, slug, base_url, config from source_connections order by slug`;
}

export async function addSourceConnection(i: SourceConnectionInput) {
  const [row] = await sql`
    insert into source_connections (source_type, slug, base_url, config)
    values (${i.sourceType}, ${i.slug}, ${i.baseUrl ?? null}, ${sql.json((i.config ?? {}) as any)})
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
      `Source connection '${slug}' still has ${count} ingested work item(s). Delete those first — removing the connection would cascade to them.`,
    );
  await sql`delete from credentials where name = ${`${conn.source_type}_token:${slug}`}`;
  await sql`delete from source_connections where id = ${conn.id}`;
  return { deleted: true, slug };
}
