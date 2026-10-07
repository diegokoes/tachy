/** The MCP server itself, and how a tool is declared on it. */
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { AppError, inBackground, log } from "@tachy/core/infra";
import { recordToolCall } from "@tachy/core/analytics";
import { resolveCurrentUserId } from "@tachy/core/access";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const server = new McpServer({ name: "tachy", version: "0.1.0" });

export type ToolConfig<I extends ZodRawShape> = {
  description?: string;
  inputSchema?: I;
  annotations?: Record<string, unknown>;
};

/**
 * Counted per person as well as per tool. The user is resolved in the
 * background and never awaited by the tool, so a slow lookup does not hold the
 * answer back.
 */
function count(name: string, writes: boolean, ok: boolean, misuse: boolean) {
  inBackground(
    resolveCurrentUserId()
      .catch(() => null)
      .then((userId) => recordToolCall(name, writes, userId, { ok, misuse })),
    "tool_call_count_failed",
  );
}

export async function runTool(
  name: string,
  handler: (args: unknown, extra: unknown) => unknown,
  args: unknown,
  extra: unknown,
  /** Whether the tool changes anything - its readOnlyHint, inverted. */
  writes = false,
) {
  const started = Date.now();
  try {
    const result = await handler(args, extra);
    log("info", "mcp_tool", { tool: name, ok: true, ms: Date.now() - started });
    count(name, writes, true, false);
    return result;
  } catch (err) {
    count(
      name,
      writes,
      false,
      err instanceof AppError && err.code === "bad_input",
    );
    const message = err instanceof Error ? err.message : String(err);
    log("error", "mcp_tool", {
      tool: name,
      ok: false,
      ms: Date.now() - started,
      ...(err instanceof AppError ? { code: err.code } : {}),
      error: message,
    });
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    };
  }
}

/**
 * Tools with no readOnlyHint whose only write is caching the ticket they were
 * asked to read. The hint is left alone - it is also what an MCP client decides
 * approvals from - but counting these as writes would put every consult on the
 * writes side of the overview.
 */
const CACHES_ONLY = new Set(["fetch_work_item", "get_context"]);

export function tool<I extends ZodRawShape>(
  name: string,
  config: ToolConfig<I>,
  handler: ToolCallback<I>,
): void {
  const writes =
    config.annotations?.readOnlyHint !== true && !CACHES_ONLY.has(name);
  const wrapped = ((args: unknown, extra: unknown) =>
    runTool(
      name,
      handler as (args: unknown, extra: unknown) => unknown,
      args,
      extra,
      writes,
    )) as ToolCallback<I>;
  server.registerTool(name, config as never, wrapped);
}
