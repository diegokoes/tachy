const MIN_SECRET_LENGTH = 8;
const MASK = "[SECRET]";

const secrets = new Set<string>();
/** Longest first, so a secret that contains another is replaced whole. */
let ordered: string[] = [];

/**
 * Every secret this process has held in plaintext, and each encoded form it
 * sent one in. Text leaving the process is masked against the literal values,
 * which holds whatever the secret looks like.
 */
export function rememberSecret<T extends string | undefined>(value: T): T {
  if (!value || value.length < MIN_SECRET_LENGTH || secrets.has(value))
    return value;
  secrets.add(value);
  ordered = [...secrets].sort((a, b) => b.length - a.length);
  return value;
}

export function maskSecrets(text: string): string {
  let masked = text;
  for (const secret of ordered)
    if (masked.includes(secret)) masked = masked.replaceAll(secret, MASK);
  return masked;
}

/** What an error says, safe to log, store or return. */
export function errorText(err: unknown): string {
  return maskSecrets(err instanceof Error ? err.message : String(err));
}

/** Test hook. */
export function forgetSecrets(): void {
  secrets.clear();
  ordered = [];
}
