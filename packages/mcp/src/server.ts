import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import {
  AppError,
  inBackground,
  log,
  recordToolCall,
  resolveCurrentUserId,
} from "@tachy/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** The MCP server itself, and how a tool is declared on it. */
export const server = new McpServer({ name: "tachy", version: "0.1.0" });

export type ToolConfig<I extends ZodRawShape> = {
  description?: string;
  inputSchema?: I;
  annotations?: Record<string, unknown>;
};

/**
 * Counted per person as well as per tool, which is the part a log scrape cannot
 * give you. The user is resolved lazily and never awaited by the tool: a slow
 * lookup must not hold the answer back.
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
  cb: (args: unknown, extra: unknown) => unknown,
  args: unknown,
  extra: unknown,
  /** Whether the tool changes anything — its readOnlyHint, inverted. */
  writes = false,
) {
  const started = Date.now();
  try {
    const res = await cb(args, extra);
    log("info", "mcp_tool", { tool: name, ok: true, ms: Date.now() - started });
    count(name, writes, true, false);
    return res;
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
 * asked to read. The hint is left alone — it is also what an MCP client decides
 * approvals from — but counting these as writes would put every consult on the
 * writes side of the overview.
 */
const CACHES_ONLY = new Set(["fetch_work_item", "get_context"]);

export function tool<I extends ZodRawShape>(
  name: string,
  config: ToolConfig<I>,
  cb: ToolCallback<I>,
): void {
  const writes =
    config.annotations?.readOnlyHint !== true && !CACHES_ONLY.has(name);
  const wrapped = ((args: unknown, extra: unknown) =>
    runTool(
      name,
      cb as (a: unknown, e: unknown) => unknown,
      args,
      extra,
      writes,
    )) as ToolCallback<I>;
  server.registerTool(name, config as never, wrapped);
}
