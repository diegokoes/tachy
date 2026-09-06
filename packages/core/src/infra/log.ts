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
    ...context.getStore(),
    ...fields,
  });
  process.stderr.write(line + "\n");
}
