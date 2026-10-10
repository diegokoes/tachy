import {
  DEFAULT_TOKEN_DAYS,
  TOKEN_LIFETIME_DAYS,
  type ApiTokenRow,
} from "@tachy/contract";

/** The lifetime choice for a token with no end date. */
export const NEVER = "never";
export type Lifetime = number | typeof NEVER;

export const DEFAULT_LIFETIME: Lifetime = DEFAULT_TOKEN_DAYS;

export const LIFETIME_OPTIONS: { value: Lifetime; label: string }[] = [
  ...TOKEN_LIFETIME_DAYS.map((days) => ({
    value: days,
    label: `${days} days`,
  })),
  { value: NEVER, label: "never expires" },
];

/** The choice as the request's `expires_in_days`, where null never expires. */
export const lifetimeDays = (choice: Lifetime): number | null =>
  choice === NEVER ? null : choice;

/** When a live token stops working, for its row. */
export const expiryNote = (
  token: Pick<ApiTokenRow, "expires_at">,
  formatDate: (iso: string) => string,
): string =>
  token.expires_at
    ? `expires ${formatDate(token.expires_at)}`
    : "never expires";

/** Whether a token still works, and if not, why. */
export function tokenState(
  token: Pick<ApiTokenRow, "revoked_at" | "expires_at">,
  now = Date.now(),
): "active" | "revoked" | "expired" {
  if (token.revoked_at) return "revoked";
  if (token.expires_at && Date.parse(token.expires_at) <= now) return "expired";
  return "active";
}
