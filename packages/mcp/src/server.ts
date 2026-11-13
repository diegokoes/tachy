/** The MCP server itself, and how a tool is declared on it. */
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import {
  AppError,
  CHECK_TOOL,
  inBackground,
  log,
  errorText,
  maskSecrets,
} from "@tachy/core/infra";
import { recordToolCall } from "@tachy/core/analytics";
import { resolveCurrentUserId } from "@tachy/core/access";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const server = new McpServer({ name: "tachy", version: "0.1.0" });

type Check = (args: never) => Promise<unknown>;

export type ToolConfig<I extends ZodRawShape> = {
  description?: string;
  inputSchema?: I;
  annotations?: Record<string, unknown>;
  /**
   * What the handler would refuse the call for, writing nothing: it throws, or
   * returns the result that says why. Runs ahead of the handler on every call.
   */
  check?: (args: z.infer<z.ZodObject<I>>) => Promise<unknown>;
};

/**
 * Counted per person as well as per tool. The user is resolved in the
 * background and never awaited by the tool, so a slow lookup does not hold the
 * answer back.
 */
function count(
  name: string,
  writes: boolean,
  outcome: { ok: boolean; misuse: boolean },
) {
  inBackground(
    resolveCurrentUserId()
      .catch(() => null)
      .then((userId) => recordToolCall(name, writes, userId, outcome)),
    "tool_call_count_failed",
  );
}

/**
 * A tool result carries whatever its handler read: a stored error, a remote's
 * reply. Each text block is masked on its way to the model.
 */
function withSecretsMasked(result: unknown): unknown {
  const blocks = (result as { content?: unknown } | null)?.content;
  if (!Array.isArray(blocks)) return result;
  return {
    ...(result as object),
    content: blocks.map((block) =>
      typeof block?.text === "string"
        ? { ...block, text: maskSecrets(block.text) }
        : block,
    ),
  };
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
    const result = withSecretsMasked(await handler(args, extra));
    log("info", "mcp_tool", { tool: name, ok: true, ms: Date.now() - started });
    count(name, writes, { ok: true, misuse: false });
    return result;
  } catch (err) {
    count(name, writes, {
      ok: false,
      misuse: err instanceof AppError && err.code === "bad_input",
    });
    const message = errorText(err);
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

const checkedTools = new Map<string, { input: z.ZodType; check: Check }>();

const NOT_REFUSED = { content: [] };

const refusedWith = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

/**
 * No content for a call that would run, the refusal otherwise. `isError` marks
 * a refusal the tool throws, which a real call answers the same way.
 */
async function checkWrite(tool: string, input: unknown) {
  const checked = checkedTools.get(tool);
  if (!checked) return NOT_REFUSED;
  const args = checked.input.safeParse(input);
  if (!args.success) return refusedWith(z.prettifyError(args.error));
  try {
    const refusal = await checked.check(args.data as never);
    return refusal ? withSecretsMasked(refusal) : NOT_REFUSED;
  } catch (err) {
    return refusedWith(errorText(err));
  }
}

server.registerTool(
  CHECK_TOOL,
  {
    description:
      "Dry run of a write tool: says why the call would be refused (rights, an unknown slug, a duplicate), or nothing when it would run. Writes nothing.",
    inputSchema: {
      tool: z.string(),
      input: z.record(z.string(), z.unknown()),
    },
    annotations: { readOnlyHint: true },
  },
  (async ({ tool, input }: { tool: string; input: unknown }) =>
    checkWrite(tool, input)) as never,
);

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
  const { check, ...registered } = config;
  const run = handler as (args: unknown, extra: unknown) => unknown;
  const checkedRun = check
    ? async (args: unknown, extra: unknown) =>
        (await check(args as never)) ?? run(args, extra)
    : run;
  if (check)
    checkedTools.set(name, {
      input: z.object(config.inputSchema ?? {}),
      check: check as Check,
    });
  const wrapped = ((args: unknown, extra: unknown) =>
    runTool(name, checkedRun, args, extra, writes)) as ToolCallback<I>;
  server.registerTool(name, registered as never, wrapped);
}
