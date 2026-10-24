import { sql } from "../infra/db";
import { badInput } from "../infra/errors";
import {
  getUserCredential,
  resolveCredential,
  sourceCredentialName,
} from "../config/credentials";
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
  const conn = await getConnection(slug);
  const token = await resolveCredential(
    sourceCredentialName(conn.source_type, conn.slug),
    ctx,
  );
  return built(conn, token);
}

/**
 * The connection's adapter with the person's own token, never another: null
 * when they have saved none, for work done on their behalf without them.
 */
export async function resolvePersonalSource(
  slug: string,
  userId: string,
): Promise<ResolvedSource | null> {
  const conn = await getConnection(slug);
  const token = await getUserCredential(
    sourceCredentialName(conn.source_type, conn.slug),
    userId,
  );
  return token ? built(conn, token) : null;
}

interface ConnectionRow {
  id: string;
  source_type: string;
  base_url: string | null;
  slug: string;
  config: Record<string, unknown> | null;
}

async function getConnection(slug: string): Promise<ConnectionRow> {
  const [conn] = await sql<ConnectionRow[]>`
    select id, source_type, base_url, slug, config
    from source_connections where slug = ${slug}
  `;
  if (!conn) throw badInput(`unknown source: ${slug}`);
  return conn;
}

function built(conn: ConnectionRow, token: string | undefined): ResolvedSource {
  const factory = factories.get(conn.source_type);
  if (!factory)
    throw badInput(
      `no adapter registered for source type: ${conn.source_type}`,
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
