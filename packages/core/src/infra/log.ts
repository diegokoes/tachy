import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "./env";

export type LogLevel = "debug" | "info" | "warn" | "error";

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const context = new AsyncLocalStorage<Record<string, unknown>>();

/**
 * Fields every line logged inside `fn` carries. The API puts a request id here
 * so lines emitted deep in core tie back to the request that caused them
 * without threading a parameter through every call between.
 */
export function runWithLogContext<T>(
  fields: Record<string, unknown>,
  fn: () => T,
): T {
  return context.run({ ...context.getStore(), ...fields }, fn);
}

export const logContext = (): Readonly<Record<string, unknown>> | undefined =>
  context.getStore();

const shipUrl = process.env.TACHY_LOG_URL;
const shipSecret = process.env.TACHY_INTERNAL_SECRET ?? "";

/**
 * An MCP child spawned for a turn cannot rely on stderr: Claude Code does not
 * pass it on. Its lines go to the API instead, which writes them to the
 * container log. Fire and forget: a lost count line must not slow a tool down.
 */
function ship(line: string): void {
  fetch(shipUrl!, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${shipSecret}`,
    },
    body: JSON.stringify({ lines: [line] }),
  }).catch(() => {});
}

export function log(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (RANK[level] < RANK[env.logLevel]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(env.turnId ? { turn: env.turnId } : {}),
    ...(process.env.TACHY_REQUEST_ID
      ? { req: process.env.TACHY_REQUEST_ID }
      : {}),
    ...context.getStore(),
    ...fields,
  });
  process.stderr.write(line + "\n");
  if (shipUrl) ship(line);
}
