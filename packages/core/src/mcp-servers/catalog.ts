import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerRow, McpServerToolRow } from "@tachy/contract";
import { sql, jsonb } from "../infra/db";
import { badInput, notFound } from "../infra/errors";
import {
  connectFailureText,
  openConnection,
  type McpConnection,
} from "./connect";
import { getMcpServer } from "./servers";

export const isReadOnly = (annotations: Record<string, unknown> | undefined) =>
  annotations?.readOnlyHint === true;

export const isDestructive = (
  annotations: Record<string, unknown> | undefined,
) => annotations?.destructiveHint === true;

/** Every page of tools/list. */
export async function fetchToolList(
  connection: McpConnection,
): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await connection.client.listTools(
      cursor ? { cursor } : undefined,
    );
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

export interface RefreshOutcome {
  total: number;
  added: string[];
  removed: string[];
}

/**
 * A new tool starts exposed only with readOnlyHint. A tool that loses the hint
 * loses exposure unless an admin vouched for it; a destructive one never has it.
 */
export async function storeToolList(
  serverId: string,
  tools: Pick<Tool, "name" | "description" | "inputSchema" | "annotations">[],
): Promise<RefreshOutcome> {
  return sql.begin(async (tx) => {
    const before = await tx`
      select name from mcp_server_tools where server_id = ${serverId}
    `;
    const known = new Set(before.map((row) => row.name as string));
    const names = tools.map((tool) => tool.name);
    for (const tool of tools) {
      const annotations = (tool.annotations ?? {}) as Record<string, unknown>;
      const startsExposed =
        isReadOnly(annotations) && !isDestructive(annotations);
      await tx`
        insert into mcp_server_tools
          (server_id, name, description, input_schema, annotations, exposed)
        values (${serverId}, ${tool.name}, ${tool.description ?? ""},
                ${jsonb(tool.inputSchema ?? {})}, ${jsonb(annotations)}, ${startsExposed})
        on conflict (server_id, name) do update set
          description = excluded.description,
          input_schema = excluded.input_schema,
          annotations = excluded.annotations,
          exposed = mcp_server_tools.exposed
            and ${!isDestructive(annotations)}
            and (${isReadOnly(annotations)} or mcp_server_tools.attested_by is not null)
      `;
    }
    const removed = await tx`
      delete from mcp_server_tools
      where server_id = ${serverId} and name <> all(${names})
      returning name
    `;
    await tx`update mcp_servers set tools_refreshed_at = now() where id = ${serverId}`;
    return {
      total: tools.length,
      added: names.filter((name) => !known.has(name)),
      removed: removed.map((row) => row.name as string),
    };
  });
}

export async function refreshTools(
  server: McpServerRow,
  token: string,
): Promise<RefreshOutcome> {
  const { value: tools } = await withConnection(server, token, fetchToolList);
  return storeToolList(server.id, tools);
}

/** A failure carries what the server answered. */
async function withConnection<T>(
  server: McpServerRow,
  token: string,
  use: (connection: McpConnection) => Promise<T>,
): Promise<{ value: T; connection: McpConnection }> {
  let connection: McpConnection;
  try {
    connection = await openConnection(server, token);
  } catch (err) {
    throw badInput(`${server.name}: ${connectFailureText(err)}`);
  }
  try {
    return { value: await use(connection), connection };
  } catch (err) {
    throw badInput(`${server.name}: ${connectFailureText(err)}`);
  } finally {
    await connection.close();
  }
}

export interface ServerProbe {
  server: { name: string; version: string } | null;
  instructions: string | null;
  tools: number;
}

/** Lists without storing: the console's test. */
export async function probeServer(
  server: McpServerRow,
  token: string,
): Promise<ServerProbe> {
  const { value: tools, connection } = await withConnection(
    server,
    token,
    fetchToolList,
  );
  const version = connection.client.getServerVersion();
  return {
    server: version ? { name: version.name, version: version.version } : null,
    instructions: connection.client.getInstructions() ?? null,
    tools: tools.length,
  };
}

export async function listServerTools(
  slug: string,
): Promise<McpServerToolRow[]> {
  const server = await getMcpServer(slug);
  const rows = await sql`
    select name, description, input_schema, annotations, exposed, attested_by
    from mcp_server_tools where server_id = ${server.id}
    order by name
  `;
  return rows as unknown as McpServerToolRow[];
}

/** A tool without readOnlyHint needs `attested`: exposed tools run unreviewed. */
export async function setToolExposed(
  slug: string,
  name: string,
  input: { exposed: boolean; attested?: boolean },
  userId: string | null,
): Promise<McpServerToolRow> {
  const server = await getMcpServer(slug);
  const [tool] = await sql`
    select annotations from mcp_server_tools
    where server_id = ${server.id} and name = ${name}
  `;
  if (!tool) throw notFound(`tool '${name}' is not listed by '${slug}'`);
  const annotations = tool.annotations as Record<string, unknown>;
  if (input.exposed && isDestructive(annotations))
    throw badInput(
      `'${name}' says it is destructive; only tools that read can be exposed`,
    );
  if (input.exposed && !isReadOnly(annotations) && !input.attested)
    throw badInput(
      `'${name}' does not say it only reads: confirm that it does to expose it`,
    );
  const attestedBy = input.exposed && !isReadOnly(annotations) ? userId : null;
  const [row] = await sql`
    update mcp_server_tools
    set exposed = ${input.exposed}, attested_by = ${attestedBy}
    where server_id = ${server.id} and name = ${name}
    returning name, description, input_schema, annotations, exposed, attested_by
  `;
  return row as unknown as McpServerToolRow;
}

export async function exposedTools(
  serverIds: string[],
): Promise<(McpServerToolRow & { server_id: string })[]> {
  if (!serverIds.length) return [];
  const rows = await sql`
    select server_id, name, description, input_schema, annotations, exposed, attested_by
    from mcp_server_tools
    where server_id = any(${serverIds}::uuid[]) and exposed
    order by server_id, name
  `;
  return rows as unknown as (McpServerToolRow & { server_id: string })[];
}
