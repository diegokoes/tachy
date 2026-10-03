import type { Context } from "hono";
import { badInput, notFound, sql } from "@tachy/core/infra";
import { resolveCredential, sourceCredentialName } from "@tachy/core/config";
import { createAdoClient, type AdoClient } from "@tachy/source-azure-devops";
import { callerScope } from "./authz";

export interface AdoConnection {
  slug: string;
  config: Record<string, unknown>;
}

/** ADO client for a connection, using the caller's own PAT. */
export async function adoClientFor(
  c: Context,
  slug: string,
): Promise<{ client: AdoClient; conn: AdoConnection }> {
  const [conn] = await sql`
    select id, source_type, slug, base_url, config
    from source_connections where slug = ${slug}
  `;
  if (!conn) throw notFound(`Unknown source connection: ${slug}`);
  if (conn.source_type !== "azure-devops")
    throw new Error(`'${slug}' is a ${conn.source_type} connection`);
  const token = await resolveCredential(
    sourceCredentialName(conn.source_type, conn.slug),
    await callerScope(c),
  );
  let client: AdoClient;
  try {
    client = createAdoClient({
      baseUrl: conn.base_url ?? "",
      slug: conn.slug,
      config: conn.config ?? {},
      ...(token ? { token } : {}),
    });
  } catch (e) {
    // The env fallback's message names server variables the person cannot set.
    if (!token && e instanceof Error && e.message.startsWith("Missing"))
      throw badInput(
        `No Azure DevOps token for '${slug}'. Add your PAT under Settings › credentials, or ask an admin to set the connection's.`,
      );
    throw e;
  }
  return { client, conn: { slug: conn.slug, config: conn.config ?? {} } };
}
