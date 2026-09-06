import { log, runWithLogContext } from "@tachy/core";
import type { Context, Next } from "hono";
import { getIdentity } from "./auth";

const STARTED_KEY = "tachyStartedAt";
const ERROR_KEY = "tachyError";

/** The Docker healthcheck fires every 30s; at info level it is pure noise. */
const QUIET_PATHS = new Set(["/health"]);

export const requestIdOf = (c: Context): string | undefined =>
  c.get("requestId" as never) as string | undefined;

/**
 * Hand the failure to the one line the request already gets, rather than
 * logging a second one beside it. onError runs before the logging middleware
 * unwinds, so what it records here is in hand by the time the line is written.
 */
export function noteError(c: Context, fields: Record<string, unknown>): void {
  c.set(ERROR_KEY as never, fields as never);
}

export async function httpLogger(c: Context, next: Next): Promise<void> {
  const started = performance.now();
  c.set(STARTED_KEY as never, started as never);
  const req = requestIdOf(c);

  await runWithLogContext({ req }, () => next());

  const status = c.res.status;
  const failure = c.get(ERROR_KEY as never) as
    Record<string, unknown> | undefined;
  const identity = getIdentity(c);

  const level =
    status >= 500
      ? "error"
      : status >= 400
        ? "warn"
        : QUIET_PATHS.has(c.req.path)
          ? "debug"
          : "info";

  log(level, "http", {
    req,
    method: c.req.method,
    path: c.req.path,
    status,
    ms: Math.round(performance.now() - started),
    user: identity?.email ?? identity?.via,
    ...failure,
  });
}
