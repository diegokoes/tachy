import type { ApiTokenRow } from "@tachy/contract";

/** Whether a token still works, and if not, why. */
export function tokenState(
  token: Pick<ApiTokenRow, "revoked_at" | "expires_at">,
  now = Date.now(),
): "active" | "revoked" | "expired" {
  if (token.revoked_at) return "revoked";
  if (token.expires_at && Date.parse(token.expires_at) <= now) return "expired";
  return "active";
}
