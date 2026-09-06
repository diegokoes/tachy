/**
 * How long one call to a source system may take. Without a deadline a hung
 * upstream hangs the tool call, the agent turn and the SSE stream behind it,
 * indefinitely and silently — nothing further up has a timeout of its own.
 */
export const SOURCE_TIMEOUT_MS = 30_000;

/**
 * A sync walks thousands of items, so meeting a rate limit is ordinary rather
 * than exceptional — and every adapter throws on any non-2xx, which without
 * this aborts the whole run. The CLI keeps no watermark, so the retry then
 * restarts from wherever the operator's `--since` pointed.
 */
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;

/** GitHub answers a secondary rate limit with 403 and a spent budget. */
function isRateLimited(res: Response): boolean {
  if (RETRY_STATUSES.has(res.status)) return true;
  return res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0";
}

/**
 * How long to wait before the next attempt. `Retry-After` is authoritative when
 * the server sends one — as seconds or as a date — and GitHub instead names the
 * epoch second its budget refills at.
 */
function retryDelayMs(res: Response, attempt: number): number {
  const after = res.headers.get("retry-after");
  if (after) {
    const seconds = Number(after);
    const ms = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(after) - Date.now();
    if (ms > 0) return Math.min(ms, MAX_RETRY_WAIT_MS);
  }
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    const ms = reset * 1000 - Date.now();
    if (ms > 0) return Math.min(ms, MAX_RETRY_WAIT_MS);
  }
  return Math.min(1000 * 2 ** attempt, MAX_RETRY_WAIT_MS);
}

const MAX_RETRY_WAIT_MS = 60_000;

/**
 * `fetch` with a deadline, and a wait when the far end asks for one. `label` is
 * what the caller would have put in its own error message, so a timeout reads
 * like the adapter's other failures rather than as a bare TimeoutError from
 * somewhere in the runtime.
 */
export async function sourceFetch(
  label: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const deadline = AbortSignal.timeout(SOURCE_TIMEOUT_MS);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, deadline])
      : deadline;
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal });
    } catch (e) {
      // fetch rejects with the signal's reason: a DOMException named TimeoutError.
      if (e instanceof Error && e.name === "TimeoutError")
        throw new Error(
          `${label} timed out after ${SOURCE_TIMEOUT_MS / 1000}s — the source system did not respond`,
        );
      throw e;
    }
    if (attempt >= MAX_RETRIES || !isRateLimited(res)) return res;
    await new Promise((r) => setTimeout(r, retryDelayMs(res, attempt)));
  }
}

/**
 * Blocks that must never be reachable from a URL someone typed into the product
 * or a model composed from ticket text: loopback, link-local (which includes the
 * cloud metadata endpoint at 169.254.169.254), and the private ranges the server
 * itself sits in. Deliberately not applied to `sourceFetch` — a self-hosted
 * GitHub Enterprise or Azure DevOps server is legitimately on a private address.
 */
function isBlockedAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (v6 === "::" || v6 === "::1") return true;
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    return mapped ? isBlockedAddress(mapped[1]) : false;
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return true;
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

const MAX_REDIRECTS = 3;

/**
 * `fetch` for a URL the product did not choose — a paste into the ingest box, a
 * link a model lifted out of a ticket. Every hop is re-checked, because a public
 * host is free to redirect to a private one.
 *
 * The address check runs before the connection rather than on it, so a name that
 * resolves differently between the two lookups is not covered. That is the known
 * limit of doing this without pinning the socket; it is a much narrower opening
 * than the unrestricted `fetch` it replaces.
 */
export async function fetchUntrustedUrl(
  label: string,
  url: string,
): Promise<Response> {
  const { lookup } = await import("node:dns/promises");
  let next = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(next);
    } catch {
      throw new Error(`${label}: '${next}' is not a URL`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new Error(
        `${label}: only http and https URLs can be fetched, not '${parsed.protocol}'`,
      );

    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    const addresses =
      /^[\d.]+$/.test(host) || host.includes(":")
        ? [{ address: host }]
        : await lookup(host, { all: true }).catch(() => {
            throw new Error(`${label}: cannot resolve '${host}'`);
          });
    if (addresses.some((a) => isBlockedAddress(a.address)))
      throw new Error(
        `${label}: '${host}' resolves to a private or loopback address`,
      );

    const res = await sourceFetch(label, next, { redirect: "manual" });
    if (res.status < 300 || res.status > 399) return res;

    const location = res.headers.get("location");
    if (!location) return res;
    next = new URL(location, next).toString();
  }
  throw new Error(`${label}: more than ${MAX_REDIRECTS} redirects`);
}
