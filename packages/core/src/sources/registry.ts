import { sql } from "../infra/db";
import { badInput } from "../infra/errors";
import { resolveCredential, sourceCredentialName } from "../config/credentials";
import type { ScopeContext } from "../config/scoped";
import type { SourceFactory, WorkItemSource } from "./source";

const factories = new Map<string, SourceFactory>();

export function registerSource(type: string, factory: SourceFactory): void {
  factories.set(type, factory);
}

export interface ResolvedSource {
  conn: {
    id: string;
    slug: string;
    sourceType: string;
    baseUrl: string | null;
    config: Record<string, unknown>;
  };
  source: WorkItemSource;
}

/**
 * `ctx` scopes the API token lookup to a caller (user → team → global → env).
 * Omit it inside the per-turn MCP subprocess, whose env already carries the
 * caller's tokens.
 */
export async function resolveSource(
  slug: string,
  ctx: ScopeContext = {},
): Promise<ResolvedSource> {
  const [conn] = await sql`
    select id, source_type, base_url, slug, config
    from source_connections where slug = ${slug}
  `;
  if (!conn) throw badInput(`Unknown source connection: ${slug}`);
  const factory = factories.get(conn.source_type);
  if (!factory)
    throw badInput(
      `No adapter registered for source type: ${conn.source_type}`,
    );
  const token = await resolveCredential(
    sourceCredentialName(conn.source_type, conn.slug),
    ctx,
  );
  return {
    conn: {
      id: conn.id,
      slug: conn.slug,
      sourceType: conn.source_type,
      baseUrl: conn.base_url,
      config: conn.config ?? {},
    },
    source: factory({
      baseUrl: conn.base_url ?? "",
      slug: conn.slug,
      config: conn.config ?? {},
      ...(token ? { token } : {}),
    }),
  };
}
