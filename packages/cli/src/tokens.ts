import { DEFAULT_TOKEN_DAYS } from "@tachy/core";
import { getUserByEmail, mintApiToken, tokenExpiry } from "@tachy/core/access";
import { recordAudit } from "@tachy/core/audit";

/**
 * The lifetime the flags ask for, in days. Null is `--never`; without either
 * flag it is the default.
 */
export function lifetimeDaysOf(flags: Record<string, string>): number | null {
  if (flags.never) return null;
  if (flags.days === undefined) return DEFAULT_TOKEN_DAYS;
  const days = Number(flags.days);
  if (!Number.isInteger(days) || days < 1)
    throw new Error(`--days needs a whole number of days, not '${flags.days}'`);
  return days;
}

/**
 * A bearer token for an account that cannot mint its own, such as the service
 * account a host script reads the api as. The return is the only time the token
 * exists in the clear.
 */
export async function mintTokenFor(
  email: string,
  name: string,
  lifetimeDays: number | null,
): Promise<{ token: string; expiresAt: string | null }> {
  const owner = await getUserByEmail(email);
  if (!owner) throw new Error(`no account '${email}'; create it first`);
  if (owner.disabled) throw new Error(`the account '${email}' is disabled`);
  const { token, row } = await mintApiToken({
    userId: owner.id,
    name,
    expiresAt: tokenExpiry(lifetimeDays),
  });
  await recordAudit({
    actor: { userId: null, actor: "api" },
    action: "api_token_mint",
    target: name,
    detail: { for: email, expires_at: row.expires_at, by: "cli" },
  });
  return { token, expiresAt: row.expires_at };
}

/**
 * The whole command. The token is for stdout, alone, so a script can capture
 * it; the note about it is for stderr.
 */
export async function mintTokenCommand(
  positional: string[],
  flags: Record<string, string>,
): Promise<{ token: string; note: string }> {
  const [email, name] = positional;
  if (!email || !name) throw new Error("mint-token needs <email> <name>");
  const minted = await mintTokenFor(email, name, lifetimeDaysOf(flags));
  return {
    token: minted.token,
    note: minted.expiresAt
      ? `expires ${new Date(minted.expiresAt).toISOString()}; it is not shown again`
      : "never expires; it is not shown again",
  };
}
