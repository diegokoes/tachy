// PII redaction applied at the MCP tool boundary — BEFORE any LLM sees the data.
// Provider-agnostic: protects Claude and any other model equally. The app still
// persists full data; only the copy handed to the model is scrubbed.
//
// Two layers cooperate:
//   - redactNormalized(): the source-agnostic RawWorkItem fields every adapter
//     produces identically (requester*, title, messages[].author/bodyText).
//   - a per-source redactRaw() hook (implemented in each source package) scrubs
//     the source-specific `raw` payload, keyed by the same TokenMap.

import type { RawWorkItem } from "../sources/source";

/**
 * Assigns stable, per-work-item tokens so the same value always maps to the same
 * token within one item (e.g. two mentions of one email both read `[EMAIL_1]`).
 * Referential context survives redaction; identities do not leak.
 */
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

// Phone matching is intentionally conservative to avoid mangling dates/IDs/error
// codes: it requires a leading '+', parenthesised area code, or three
// separator-delimited digit groups — none of which match ISO dates like
// 2015-08-24 or status codes like "HTTP 503".
const PHONE_RE =
  /(?:\+\d[\d\s().-]{6,}\d)|(?:\(\d{2,4}\)[\s.-]?\d{3,4}[\s.-]?\d{3,4})|(?:\b\d{3}[\s.-]\d{3,4}[\s.-]\d{3,4}\b)/g;

/** Replace emails and phone numbers in free text with stable tokens. */
export function scrubText(text: string | undefined, map: TokenMap): string {
  if (!text) return text ?? "";
  let out = text.replace(EMAIL_RE, (m) => map.token("EMAIL", m));
  out = out.replace(PHONE_RE, (m) => map.token("PHONE", m));
  return out;
}

export interface RedactOptions {
  /** Resolved customer slug to stand in for the requester (company signal kept). */
  customerSlug?: string | null;
  map: TokenMap;
}

/**
 * Deep copy of a RawWorkItem with the source-agnostic normalized fields scrubbed.
 * Never mutates the input — the same object is what the app persists.
 * The `raw` payload is left untouched here; the caller replaces it with the
 * source-specific redaction (see redactForLlm).
 */
export function redactNormalized(item: RawWorkItem, opts: RedactOptions): RawWorkItem {
  const { customerSlug, map } = opts;
  const customerToken = customerSlug || "[CUSTOMER]";
  return {
    ...item,
    title: item.title ? scrubText(item.title, map) : item.title,
    requester: item.requester ? customerToken : item.requester,
    requesterEmail: undefined,
    messages: item.messages.map((m) => ({
      ...m,
      author: m.author ? map.token("USER", m.author) : m.author,
      bodyText: scrubText(m.bodyText, map),
    })),
  };
}

/**
 * Full redaction for handing to the model: normalized fields + the source's own
 * `raw` scrub, sharing one TokenMap so tokens are consistent across both layers.
 * If the source provides no redactRaw hook, the raw payload is dropped entirely
 * (safer than leaking an un-scrubbed source-specific blob).
 */
export function redactForLlm(
  item: RawWorkItem,
  redactRaw: ((raw: unknown, map: TokenMap, customerSlug: string | null) => unknown) | undefined,
  customerSlug: string | null,
): RawWorkItem {
  const map = new TokenMap();
  const normalized = redactNormalized(item, { customerSlug, map });
  return { ...normalized, raw: redactRaw ? redactRaw(item.raw, map, customerSlug) : {} };
}

export interface RedactionPolicy {
  enabled: boolean;
}

/** Read the redaction switch off a source connection's `config` jsonb. */
export function resolveRedactionPolicy(
  config: Record<string, unknown> | null | undefined,
): RedactionPolicy {
  const r = (config ?? {})["redaction"] as { enabled?: unknown } | undefined;
  return { enabled: r != null && typeof r === "object" && r.enabled === true };
}
