import { BlockList, isIP } from "node:net";
import { countSourceCall } from "./traffic";

/**
 * How long one call to a source system may take. Without a deadline a hung
 * upstream hangs the tool call, the agent turn and the SSE stream behind it:
 * nothing further up has a timeout of its own.
 */
export const SOURCE_TIMEOUT_MS = 30_000;

/**
 * A sync walks thousands of items, so meeting a rate limit is ordinary. Every
 * adapter throws on a non-2xx, which without a retry aborts the whole run.
 */
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;

/** GitHub answers a secondary rate limit with 403 and a spent budget. */
function isRateLimited(response: Response): boolean {
  if (RETRY_STATUSES.has(response.status)) return true;
  return (
    response.status === 403 &&
    response.headers.get("x-ratelimit-remaining") === "0"
  );
}

/**
 * How long to wait before the next attempt. `Retry-After` is authoritative when
 * the server sends one - as seconds or as a date - and GitHub instead names the
 * epoch second its budget refills at.
 */
function retryDelayMs(response: Response, attempt: number): number {
  const after = response.headers.get("retry-after");
  if (after) {
    const seconds = Number(after);
    const ms = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(after) - Date.now();
    if (ms > 0) return Math.min(ms, MAX_RETRY_WAIT_MS);
  }
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    const ms = reset * 1000 - Date.now();
    if (ms > 0) return Math.min(ms, MAX_RETRY_WAIT_MS);
  }
  return Math.min(1000 * 2 ** attempt, MAX_RETRY_WAIT_MS);
}

const MAX_RETRY_WAIT_MS = 60_000;

/** ADO answers a bad PAT with a 203 sign-in page rather than a 401. */
const AUTH_STATUSES = new Set([401, 403, 203]);

/**
 * `fetch` with a deadline, and a wait when the far end asks for one. `label` is
 * what the caller would put in its own error message, so a timeout reads like
 * the adapter's other failures. `meter` names the connection the call is spent
 * against, counted once per logical call however many retries it took; without
 * it the call is not counted.
 */
export async function sourceFetch(
  label: string,
  url: string,
  init?: RequestInit,
  meter?: { connection: string },
): Promise<Response> {
  let limited = false;
  for (let attempt = 0; ; attempt++) {
    const deadline = AbortSignal.timeout(SOURCE_TIMEOUT_MS);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, deadline])
      : deadline;
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal });
    } catch (e) {
      if (meter)
        countSourceCall(meter.connection, {
          rateLimited: limited,
          authFailed: false,
        });
      // fetch rejects with the signal's reason: a DOMException named TimeoutError.
      if (e instanceof Error && e.name === "TimeoutError")
        throw new Error(
          `${label} timed out after ${SOURCE_TIMEOUT_MS / 1000}s; no response from the source`,
        );
      throw e;
    }
    const throttled = isRateLimited(response);
    limited ||= throttled;
    if (attempt >= MAX_RETRIES || !throttled) {
      if (meter)
        countSourceCall(meter.connection, {
          rateLimited: limited,
          authFailed: !throttled && AUTH_STATUSES.has(response.status),
        });
      return response;
    }
    await new Promise((r) => setTimeout(r, retryDelayMs(response, attempt)));
  }
}

type Subnet = [network: string, prefixBits: number];

/**
 * Loopback, link-local (which includes the cloud metadata endpoint at
 * 169.254.169.254), the private and carrier ranges the server itself sits in,
 * benchmarking, and everything from multicast up.
 */
const BLOCKED_IPV4_SUBNETS: Subnet[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
];

/** Unspecified, loopback, unique-local and link-local. */
const BLOCKED_IPV6_SUBNETS: Subnet[] = [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
];

/** RFC 6052: a NAT64 gateway forwards to the IPv4 address in the last 32 bits. */
const NAT64_PREFIX = "64:ff9b::";
const NAT64_PREFIX_BITS = 96;

/** An IPv4 network as the NAT64 address that reaches it. */
function nat64Network(ipv4: string): string {
  const [first, second, third, fourth] = ipv4.split(".").map(Number);
  const hextet = (high: number, low: number) =>
    ((high << 8) | low).toString(16);
  return `${NAT64_PREFIX}${hextet(first, second)}:${hextet(third, fourth)}`;
}

/**
 * Where a URL someone typed into the product, or a model composed from ticket
 * text, must never reach. Not applied to `sourceFetch`: a self-hosted GitHub
 * Enterprise or Azure DevOps server is legitimately on a private address.
 */
const blockedAddresses = new BlockList();
for (const [network, prefixBits] of BLOCKED_IPV4_SUBNETS) {
  blockedAddresses.addSubnet(network, prefixBits, "ipv4");
  blockedAddresses.addSubnet(
    nat64Network(network),
    NAT64_PREFIX_BITS + prefixBits,
    "ipv6",
  );
}
for (const [network, prefixBits] of BLOCKED_IPV6_SUBNETS)
  blockedAddresses.addSubnet(network, prefixBits, "ipv6");

/**
 * `BlockList` reads an IPv4-mapped IPv6 address as the IPv4 address it stands
 * for, in the dotted form and in the hex form (`::ffff:7f00:1`) a URL parser
 * rewrites it to. Text that is not an address is refused.
 */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return true;
  return blockedAddresses.check(ip, family === 6 ? "ipv6" : "ipv4");
}

const MAX_REDIRECTS = 3;

/**
 * `fetch` for a URL the product did not choose: a paste into the ingest box, a
 * link a model lifted out of a ticket. Every hop is re-checked, because a
 * public host can redirect to a private one. The address is checked before the
 * connection, not on it, so a name that resolves differently between the two
 * lookups is not covered.
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
      isIP(host) !== 0
        ? [{ address: host }]
        : await lookup(host, { all: true }).catch(() => {
            throw new Error(`${label}: cannot resolve '${host}'`);
          });
    if (addresses.some((a) => isBlockedAddress(a.address)))
      throw new Error(
        `${label}: '${host}' resolves to a private or loopback address`,
      );

    const response = await sourceFetch(label, next, { redirect: "manual" });
    if (response.status < 300 || response.status > 399) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    next = new URL(location, next).toString();
  }
  throw new Error(`${label}: more than ${MAX_REDIRECTS} redirects`);
}
