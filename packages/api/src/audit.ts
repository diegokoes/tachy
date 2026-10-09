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
