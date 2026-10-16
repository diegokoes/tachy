import type { Context } from "hono";
import { badInput } from "@tachy/core/infra";
import { resolveSource } from "@tachy/core/sources";
import { callerScope } from "./authz";

/** A connection's adapter with the caller's own token. */
export async function callerSource(c: Context, slug: string) {
  try {
    return await resolveSource(slug, await callerScope(c));
  } catch (e) {
    // An adapter's env fallback names server variables the person cannot set.
    if (e instanceof Error && e.message.startsWith("Missing"))
      throw badInput(
        `No token for '${slug}'. Add yours under Settings › credentials, or ask an admin to set the connection's.`,
      );
    throw e;
  }
}
