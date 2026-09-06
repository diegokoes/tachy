import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { AppError, log } from "@tachy/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** The MCP server itself, and how a tool is declared on it. */
export const server = new McpServer({ name: "tachy", version: "0.1.0" });

export type ToolConfig<I extends ZodRawShape> = {
  description?: string;
  inputSchema?: I;
  annotations?: Record<string, unknown>;
};

export async function runTool(
  name: string,
  cb: (args: unknown, extra: unknown) => unknown,
  args: unknown,
  extra: unknown,
) {
  const started = Date.now();
  try {
    const res = await cb(args, extra);
    log("info", "mcp_tool", { tool: name, ok: true, ms: Date.now() - started });
    return res;
  } catch (err) {
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

export function tool<I extends ZodRawShape>(
  name: string,
  config: ToolConfig<I>,
  cb: ToolCallback<I>,
): void {
  const wrapped = ((args: unknown, extra: unknown) =>
    runTool(
      name,
      cb as (a: unknown, e: unknown) => unknown,
      args,
      extra,
    )) as ToolCallback<I>;
  server.registerTool(name, config as never, wrapped);
}
