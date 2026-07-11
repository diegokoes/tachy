import type { RawWorkItem } from "../types";

/** Stable per-item tokens: the same value always maps to the same `[KIND_n]`. */
export class TokenMap {
  private counts = new Map<string, number>();
  private seen = new Map<string, string>();

  token(kind: string, value: string): string {
    const key = `${kind}:${value.trim().toLowerCase()}`;
    const existing = this.seen.get(key);
    if (existing) return existing;
    const n = (this.counts.get(kind) ?? 0) + 1;
    this.counts.set(kind, n);
    const t = `[${kind}_${n}]`;
    this.seen.set(key, t);
    return t;
  }
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const PHONE_RE =
  /(?:\+\d[\d\s().-]{6,}\d)|(?:\(\d{2,4}\)[\s.-]?\d{3,4}[\s.-]?\d{3,4})|(?:\b\d{3}[\s.-]\d{3,4}[\s.-]\d{3,4}\b)/g;

const PEM_RE =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

const CREDENTIAL_ASSIGN_RE =
  /\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|authorization)\b(\s*[:=]\s*)("[^"\n]+"|'[^'\n]+'|[^\s,;'"]+)/gi;
const BEARER_RE = /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{8,})/g;

const KNOWN_KEY_RES = [
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
];

const CARD_RE = /\b\d(?:[ -]?\d){12,18}\b/g;

function luhnValid(candidate: string): boolean {
  const digits = candidate.replace(/[ -]/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Replace secrets, card numbers, emails, and phone numbers in free text with stable tokens. */
export function scrubText(text: string | undefined, map: TokenMap): string {
  if (!text) return text ?? "";
  let out = text.replace(PEM_RE, (m) => map.token("SECRET", m));

  out = out.replace(
    BEARER_RE,
    (_m, prefix, token) => `${prefix}${map.token("SECRET", token)}`,
  );
  out = out.replace(CREDENTIAL_ASSIGN_RE, (m, key, sep, value) =>
    value.startsWith("[") || /^bearer$/i.test(value)
      ? m
      : `${key}${sep}${map.token("SECRET", value)}`,
  );
  for (const re of KNOWN_KEY_RES)
    out = out.replace(re, (m) => map.token("SECRET", m));
  out = out.replace(CARD_RE, (m) => (luhnValid(m) ? map.token("CARD", m) : m));
  out = out.replace(EMAIL_RE, (m) => map.token("EMAIL", m));
  out = out.replace(PHONE_RE, (m) => map.token("PHONE", m));
  return out;
}

/**
 * Tokenize known person names wherever they appear in free text — same USER
 * kind as the author fields, so mentions map to the same token. Best-effort:
 * only names the item itself declares are matched.
 */
export function scrubKnownNames(
  text: string | undefined,
  names: (string | undefined | null)[],
  map: TokenMap,
): string {
  if (!text) return text ?? "";
  let out = text;
  for (const name of names) {
    const n = name?.trim();
    if (!n || n.length < 3) continue;
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "gi"), () =>
      map.token("USER", n),
    );
  }
  return out;
}

/**
 * Scrub every string in a JSON-ish structure without mutating it. Non-plain
 * objects (e.g. Date from DB rows) pass through untouched.
 */
export function scrubDeep<T>(value: T, map: TokenMap): T {
  if (typeof value === "string") return scrubText(value, map) as unknown as T;
  if (Array.isArray(value))
    return value.map((v) => scrubDeep(v, map)) as unknown as T;
  if (
    value !== null &&
    typeof value === "object" &&
    value.constructor === Object
  ) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k] = scrubDeep(v, map);
    return out as T;
  }
  return value;
}

export interface RedactOptions {
  /** Resolved customer slug to stand in for the requester (company signal kept). */
  customerSlug?: string | null;
  map: TokenMap;
}

/**
 * Copy of a RawWorkItem with the normalized fields scrubbed; never mutates the
 * input (the original is what gets persisted). `raw` is the caller's job.
 */
export function redactNormalized(
  item: RawWorkItem,
  opts: RedactOptions,
): RawWorkItem {
  const { customerSlug, map } = opts;
  const customerToken = customerSlug || "[CUSTOMER]";

  const knownNames = [item.requester, ...item.messages.map((m) => m.author)];
  const scrub = (text: string | undefined) =>
    scrubKnownNames(scrubText(text, map), knownNames, map);
  return {
    ...item,
    title: item.title ? scrub(item.title) : item.title,
    requester: item.requester ? customerToken : item.requester,
    requesterEmail: undefined,
    messages: item.messages.map((m) => ({
      ...m,
      author: m.author ? map.token("USER", m.author) : m.author,
      bodyText: scrub(m.bodyText),
    })),
  };
}

/**
 * Full redaction for the model: normalized fields + the source's `raw` scrub on
 * one shared TokenMap. No redactRaw hook → raw is dropped, not leaked.
 */
export function redactForLlm(
  item: RawWorkItem,
  redactRaw:
    | ((raw: unknown, map: TokenMap, customerSlug: string | null) => unknown)
    | undefined,
  customerSlug: string | null,
): RawWorkItem {
  const map = new TokenMap();
  const normalized = redactNormalized(item, { customerSlug, map });
  return {
    ...normalized,
    raw: redactRaw ? redactRaw(item.raw, map, customerSlug) : {},
  };
}

export interface RedactionPolicy {
  enabled: boolean;
}

/**
 * TACHY_REDACT forces redaction on everywhere and is the only policy source for
 * connection-less surfaces. Read at call time (not via the parsed-once env
 * object) so tests and long-lived processes can toggle it.
 */
export function globalRedactionEnabled(): boolean {
  const v = process.env.TACHY_REDACT;
  return v === "true" || v === "1";
}

/** Read the redaction switch off a source connection's `config` jsonb (the global flag overrides). */
export function resolveRedactionPolicy(
  config: Record<string, unknown> | null | undefined,
): RedactionPolicy {
  if (globalRedactionEnabled()) return { enabled: true };
  const r = (config ?? {})["redaction"] as { enabled?: unknown } | undefined;
  return { enabled: r != null && typeof r === "object" && r.enabled === true };
}
