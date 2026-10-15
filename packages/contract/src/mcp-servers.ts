/**
 * MCP servers an admin links: what the console form, the vault and tachy's own
 * MCP process agree on about a server's shape, its credential names and the
 * names its tools are offered under.
 */
import { SLUG_RE } from "./vocabulary";
import { isSourceBaseUrl } from "./sources";

export const MCP_TRANSPORTS = ["http", "stdio"] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export const MCP_CREDENTIAL_MODES = ["personal", "shared"] as const;
export type McpCredentialMode = (typeof MCP_CREDENTIAL_MODES)[number];

/** Replaced with the credential's value when a template is rendered. */
export const TOKEN_PLACEHOLDER = "{{token}}";
/** Replaced with the connection's own temporary directory. */
export const DIR_PLACEHOLDER = "{{dir}}";

export interface McpHttpConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface McpStdioFile {
  /** Relative to the connection's temporary directory. */
  path: string;
  content: string;
}

export interface McpStdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  files?: McpStdioFile[];
}

export interface RateWindow {
  seconds: number;
  limit: number;
}

export interface McpServerRow {
  id: string;
  slug: string;
  name: string;
  transport: McpTransport;
  config: McpHttpConfig | McpStdioConfig;
  credential_mode: McpCredentialMode;
  tool_prefix: string;
  rate_windows: RateWindow[];
  rate_limit_codes: number[];
  argument_bindings: Record<string, string>;
  result_max_chars: number;
  call_timeout_ms: number;
  redaction: boolean;
  enabled: boolean;
  note: string | null;
  tools_refreshed_at: string | null;
  teams: { slug: string; name: string }[];
  /** Tools the last refresh listed, and how many of them are exposed. */
  tools: number;
  exposed: number;
  created_at: string;
}

export interface McpServerToolRow {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  annotations: Record<string, unknown>;
  exposed: boolean;
  /** Set when an admin vouched that a tool without a read-only hint only reads. */
  attested_by: string | null;
}

/** A shared-pool credential as the console lists it: never the value. */
export interface McpPoolCredential {
  label: string;
  updated_at: string;
  /** Calls spent in each rate window that is open now. */
  usage: { seconds: number; calls: number; limit: number }[];
  cooling_until: string | null;
}

export const MCP_TOKEN_CREDENTIAL = "mcp_token";

/**
 * A personal token is `mcp_token:<slug>` at user scope; a pool member is
 * `mcp_token:<slug>:<label>` at global scope.
 */
export function mcpServerCredentialName(slug: string, label?: string): string {
  return label
    ? `${MCP_TOKEN_CREDENTIAL}:${slug}:${label}`
    : `${MCP_TOKEN_CREDENTIAL}:${slug}`;
}

export const POOL_LABEL_RE = SLUG_RE;

/** Lowercase, starts with a letter: it opens every proxied tool name. */
export const TOOL_PREFIX_RE = /^[a-z][a-z0-9_]{0,19}$/;

/** Claude caps a tool name at 64 characters, and `mcp__tachy__` takes 12. */
export const MAX_PROXIED_NAME_CHARS = 52;

const HASH_HEX_CHARS = 8;

/** FNV-1a: a stable short suffix for a name cut to fit, with no dependency. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(HASH_HEX_CHARS, "0");
}

/**
 * The name a remote tool is offered under. Characters a tool name may not hold
 * become `_`; a name too long keeps its start and gains a hash of the whole, so
 * two long names that share a start stay apart.
 */
export function proxiedToolName(prefix: string, name: string): string {
  const full = `${prefix}_${name}`.replace(/[^A-Za-z0-9_-]/g, "_");
  if (full.length <= MAX_PROXIED_NAME_CHARS) return full;
  const kept = full.slice(0, MAX_PROXIED_NAME_CHARS - HASH_HEX_CHARS - 1);
  return `${kept}_${shortHash(full)}`;
}

/** http or https with no credentials in it, like a source connection's address. */
export const isMcpServerUrl = isSourceBaseUrl;
