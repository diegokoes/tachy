/** Linked servers' exposed tools, registered from the stored catalog before the transport connects, so a turn starts without remote calls. */
import { z } from "zod";
import { proxiedToolName, type McpServerRow } from "@tachy/core";
import { log, errorText } from "@tachy/core/infra";
import {
  CUSTOMER_ARGUMENT,
  applyBindings,
  boundArguments,
  callServerTool,
  exposedTools,
  listMcpServers,
  readTurnTokens,
  shapeResult,
  type ServerCredential,
  type TurnTokens,
} from "@tachy/core/mcp-servers";
import type { McpServerToolRow } from "@tachy/core";
import { runTool, server } from "../server";

/** Chars of an unconvertible schema quoted in the description. */
const SCHEMA_QUOTE_CHARS = 4000;

type ObjectSchema = z.ZodObject<z.ZodRawShape>;

/** Unknown keys pass through for the server to check. Unconvertible: an open object, schema quoted. */
function inputSchemaOf(jsonSchema: Record<string, unknown>): {
  schema: ObjectSchema;
  quoted: string | null;
} {
  try {
    const converted = z.fromJSONSchema(jsonSchema as never);
    if (converted instanceof z.ZodObject)
      return { schema: (converted as ObjectSchema).loose(), quoted: null };
  } catch {
    // Falls through to the open object.
  }
  return {
    schema: z.looseObject({}),
    quoted: JSON.stringify(jsonSchema).slice(0, SCHEMA_QUOTE_CHARS),
  };
}

/** Bound arguments become optional; `tachy_customer` fills them. */
function withCustomerArgument(
  schema: ObjectSchema,
  bound: string[],
): ObjectSchema {
  if (!bound.length) return schema;
  const optional = Object.fromEntries(
    bound
      .filter((argument) => argument in schema.shape)
      .map((argument) => [
        argument,
        (schema.shape[argument] as z.ZodType).optional(),
      ]),
  );
  return schema.extend({
    ...optional,
    [CUSTOMER_ARGUMENT]: z
      .string()
      .optional()
      .describe("A tachy customer slug or alias."),
  });
}

function descriptionOf(
  linked: McpServerRow,
  remote: McpServerToolRow,
  bound: string[],
  quoted: string | null,
): string {
  const parts = [remote.description.trim(), `[${linked.name}, via tachy]`];
  if (bound.length) {
    const kinds = bound.map((argument) => linked.argument_bindings[argument]);
    parts.push(
      `Pass ${CUSTOMER_ARGUMENT} to fill ${bound.join(", ")} from that customer's ${kinds.join(", ")} facts.`,
    );
  }
  if (linked.note) parts.push(linked.note);
  if (quoted) parts.push(`Arguments (JSON Schema): ${quoted}`);
  return parts.filter(Boolean).join("\n\n");
}

function registerProxiedTool(
  linked: McpServerRow,
  remote: McpServerToolRow,
  credentials: ServerCredential[],
): string {
  const name = proxiedToolName(linked.tool_prefix, remote.name);
  const bound = boundArguments(linked, remote.input_schema);
  const { schema, quoted } = inputSchemaOf(remote.input_schema);
  const handler = async (args: unknown) => {
    const forwarded = await applyBindings(
      linked,
      bound,
      args as Record<string, unknown>,
    );
    const result = await callServerTool(
      linked,
      credentials,
      remote.name,
      forwarded,
    );
    return shapeResult(linked, result);
  };
  server.registerTool(
    name,
    {
      description: descriptionOf(linked, remote, bound, quoted),
      inputSchema: withCustomerArgument(schema, bound),
      annotations: { readOnlyHint: true },
    },
    ((args: unknown, extra: unknown) =>
      runTool(name, handler, args, extra)) as never,
  );
  return name;
}

/** Returns the registered names. A name already taken is skipped and logged. */
export async function registerProxiedTools(
  tokens: TurnTokens = readTurnTokens(),
): Promise<string[]> {
  const slugs = Object.keys(tokens);
  if (!slugs.length) return [];
  const linkedServers = (await listMcpServers()).filter(
    (linked) => linked.enabled && slugs.includes(linked.slug),
  );
  const tools = await exposedTools(linkedServers.map((linked) => linked.id));
  const registered: string[] = [];
  for (const remote of tools) {
    const linked = linkedServers.find(
      (entry) => entry.id === remote.server_id,
    )!;
    try {
      registered.push(
        registerProxiedTool(linked, remote, tokens[linked.slug] ?? []),
      );
    } catch (err) {
      log("warn", "mcp_server_tool_skipped", {
        server: linked.slug,
        tool: remote.name,
        error: errorText(err),
      });
    }
  }
  return registered;
}
