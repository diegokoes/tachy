import { sql } from "../infra/db";
import { badInput, notFound } from "../infra/errors";

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

export interface SourceProductMapInput {
  sourceSlug: string;
  externalGroupKey: string;
  productSlug: string;
}

export async function listSourceProductMaps(sourceSlug?: string) {
  return sql`
    select spm.id, sc.slug as source_slug, spm.external_group_key,
           p.slug as product_slug, p.name as product_name
    from source_product_map spm
    join source_connections sc on sc.id = spm.source_connection_id
    join products p on p.id = spm.product_id
    ${sourceSlug ? sql`where sc.slug = ${sourceSlug}` : sql``}
    order by sc.slug, spm.external_group_key
  `;
}

export async function deleteSourceProductMap(id: string) {
  const [row] =
    await sql`delete from source_product_map where id = ${id} returning id`;
  if (!row) throw notFound(`Source product map '${id}' not found`);
  return { deleted: true, id };
}

export async function addSourceProductMap(i: SourceProductMapInput) {
  const [conn] =
    await sql`select id from source_connections where slug = ${i.sourceSlug}`;
  if (!conn)
    throw badInput(
      `Unknown source connection '${i.sourceSlug}'. Call list_source_connections first.`,
    );
  const [product] =
    await sql`select id from products where slug = ${i.productSlug}`;
  if (!product)
    throw badInput(
      `Unknown product '${i.productSlug}'. Call list_products or add_product first.`,
    );
  const [row] = await sql`
    insert into source_product_map (source_connection_id, external_group_key, product_id)
    values (${conn.id}, ${i.externalGroupKey}, ${product.id})
    on conflict (source_connection_id, external_group_key) do update set
      product_id = excluded.product_id
    returning id, external_group_key
  `;
  return row;
}
