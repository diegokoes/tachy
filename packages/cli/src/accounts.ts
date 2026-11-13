import { MIN_PASSWORD_LENGTH } from "@tachy/core";
import {
  createUser,
  getUserByEmail,
  setUserFlags,
  setUserPassword,
} from "@tachy/core/access";
import { recordAudit } from "@tachy/core/audit";

const EMAIL = /^[^\s@]+@[^\s@]+$/;

/**
 * A member a host script acts as. With a password it may sign in with one
 * under SSO too. Running it again for the same address keeps the account and
 * replaces the password when one is given.
 */
export async function ensureServiceAccount(
  email: string,
  password?: string,
): Promise<"created" | "updated"> {
  if (!EMAIL.test(email)) throw new Error(`'${email}' is not an address`);
  if (password !== undefined && password.length < MIN_PASSWORD_LENGTH)
    throw new Error(
      `the password needs at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  const flags = {
    serviceAccount: true,
    passwordLoginAllowed: password !== undefined ? true : undefined,
  };
  const detail = {
    role: "member",
    with_password: password !== undefined,
    service_account: true,
    by: "cli",
  };

  const existing = await getUserByEmail(email);
  if (!existing) {
    await createUser({ email, password, ...flags });
    await recordAudit({
      actor: { userId: null, actor: "api" },
      action: "user_create",
      target: email,
      detail,
    });
    return "created";
  }

  if (existing.role === "admin")
    throw new Error(`'${email}' is an admin; a service account is a member`);
  if (existing.disabled) throw new Error(`the account '${email}' is disabled`);
  await setUserFlags(existing.id, flags);
  if (password !== undefined) await setUserPassword(existing.id, password);
  await recordAudit({
    actor: { userId: null, actor: "api" },
    action: "user_update",
    target: email,
    detail,
  });
  return "updated";
}

/**
 * The whole command. The password arrives on stdin, never in argv, which
 * every process on the host can read.
 */
export async function serviceAccountCommand(
  positional: string[],
  flags: Record<string, string>,
  readStdin: () => Promise<string>,
): Promise<string> {
  const [email] = positional;
  if (!email) throw new Error("service-account needs an <email>");
  const password = flags["password-stdin"]
    ? (await readStdin()).replace(/\r?\n$/, "")
    : undefined;
  const outcome = await ensureServiceAccount(email, password);
  return `${outcome} ${email}`;
}
