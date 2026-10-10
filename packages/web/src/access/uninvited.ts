import { NOT_INVITED } from "@tachy/contract";

/** The refusal of a sign-in nobody added an account for, or null for any other answer. */
export function uninvitedFrom(
  status: number,
  body: unknown,
): { email: string | null } | null {
  const answer = body as { code?: unknown; email?: unknown } | null;
  if (status !== 403 || answer?.code !== NOT_INVITED) return null;
  return { email: typeof answer.email === "string" ? answer.email : null };
}
