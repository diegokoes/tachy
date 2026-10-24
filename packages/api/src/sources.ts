import type { Context } from "hono";
import { badInput } from "@tachy/core/infra";
import { resolveSource } from "@tachy/core/sources";
import { callerScope } from "./authz";

/**
 * The error to throw for `e`: a missing token becomes bad input naming
 * `slug`, since the env fallback's message names server variables the person
 * cannot set. Anything else is returned as it is.
 */
export function asNoToken(slug: string, e: unknown): unknown {
  if (!(e instanceof Error) || !e.message.startsWith("Missing")) return e;
  return badInput(
    `No token for '${slug}'. Add yours under Settings › agent, or ask an app admin to set one on the source.`,
  );
}

/** A connection's adapter with the caller's own token. */
export async function callerSource(c: Context, slug: string) {
  try {
    return await resolveSource(slug, await callerScope(c));
  } catch (e) {
    throw asNoToken(slug, e);
  }
}
