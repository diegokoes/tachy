import type { Context } from "hono";
import type { AuditAction } from "@tachy/core";
import { recordAudit } from "@tachy/core/audit";
import { callerActor } from "./authz";
import { callerAddress } from "./throttle";

/** Records what the caller of this request just did. */
export async function audit(
  c: Context,
  action: AuditAction,
  target?: string | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  await recordAudit({
    actor: await callerActor(c),
    action,
    target,
    detail,
    address: callerAddress(c),
  });
}

/**
 * Runs the write, then records it: a refused or failed write leaves no row.
 * The target is `kind:slug`, as the chat tools write it for the same things.
 */
export async function audited<T>(
  c: Context,
  action: AuditAction,
  target: string,
  write: () => Promise<T>,
  detail?: Record<string, unknown>,
): Promise<T> {
  const result = await write();
  await audit(c, action, target, detail);
  return result;
}
