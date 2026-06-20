import { sql } from "./db";
import type { SourceFactory, WorkItemSource } from "./source";

const factories = new Map<string, SourceFactory>();

export function registerSource(type: string, factory: SourceFactory): void {
  factories.set(type, factory);
}

export interface ResolvedSource {
  conn: { id: string; slug: string; sourceType: string; baseUrl: string | null };
  source: WorkItemSource;
}

export async function resolveSource(slug: string): Promise<ResolvedSource> {
  const [conn] = await sql`
    select id, source_type, base_url, slug
    from source_connections where slug = ${slug}
  `;
  if (!conn) throw new Error(`Unknown source connection: ${slug}`);
  const factory = factories.get(conn.source_type);
  if (!factory) throw new Error(`No adapter registered for source type: ${conn.source_type}`);
  return {
    conn: { id: conn.id, slug: conn.slug, sourceType: conn.source_type, baseUrl: conn.base_url },
    source: factory({ baseUrl: conn.base_url ?? "", slug: conn.slug }),
  };
}
