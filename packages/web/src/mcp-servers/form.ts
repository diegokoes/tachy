/** Converts between the form's text fields and the API shape. */
import type {
  McpHttpConfig,
  McpServerRow,
  McpStdioConfig,
  McpStdioFile,
  RateWindow,
} from "@tachy/contract";

export type Draft = Record<string, string | number | boolean | null>;

const FILE_MARK = "--- ";
const PREFIX_MAX_CHARS = 20;
const FALLBACK_PREFIX = "mcp";

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** `name<sep>value` per line, split at the first separator. */
export function parsePairs(text: string, sep: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const line of lines(text)) {
    const at = line.indexOf(sep);
    if (at <= 0)
      throw new Error(`'${line}' needs a name, '${sep}' and a value`);
    pairs[line.slice(0, at).trim()] = line.slice(at + sep.length).trim();
  }
  return pairs;
}

export function formatPairs(
  pairs: Record<string, string> | undefined,
  sep: string,
): string {
  return Object.entries(pairs ?? {})
    .map(([name, value]) => `${name}${sep}${value}`)
    .join("\n");
}

export const parseLines = lines;
export const formatLines = (list: string[] | undefined) =>
  (list ?? []).join("\n");

/** `seconds/limit`, comma-separated: `60/15, 3600/150`. */
export function parseWindows(text: string): RateWindow[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^(\d+)\s*\/\s*(\d+)$/.exec(part);
      if (!match) throw new Error(`'${part}' is not seconds/limit`);
      return { seconds: Number(match[1]), limit: Number(match[2]) };
    });
}

export const formatWindows = (windows: RateWindow[]) =>
  windows.map((window) => `${window.seconds}/${window.limit}`).join(", ");

export function parseCodes(text: string): number[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (!/^-?\d+$/.test(part)) throw new Error(`'${part}' is not a code`);
      return Number(part);
    });
}

export const formatCodes = (codes: number[]) => codes.join(", ");

/** Files as blocks: a `--- path` line, then that file's content. */
export function parseFiles(text: string): McpStdioFile[] {
  const files: McpStdioFile[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith(FILE_MARK)) {
      files.push({ path: line.slice(FILE_MARK.length).trim(), content: "" });
      continue;
    }
    const current = files.at(-1);
    if (current) current.content += `${line}\n`;
    else if (line.trim())
      throw new Error(`start each file with a '${FILE_MARK}path' line`);
  }
  return files.map((file) => ({
    ...file,
    content: file.content.replace(/\n+$/, "\n"),
  }));
}

export function formatFiles(files: McpStdioFile[] | undefined): string {
  return (files ?? [])
    .map(
      (file) => `${FILE_MARK}${file.path}\n${file.content.replace(/\n$/, "")}`,
    )
    .join("\n");
}

export function toolPrefixFor(slug: string): string {
  return slug
    .replace(/-/g, "_")
    .replace(/^[^a-z]+/, "")
    .slice(0, PREFIX_MAX_CHARS);
}

/** `toolPrefixFor(slug)`, or with a `_<n>` suffix when another server holds it. */
export function uniqueToolPrefix(slug: string, taken: string[]): string {
  const base = toolPrefixFor(slug) || FALLBACK_PREFIX;
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = base.slice(0, PREFIX_MAX_CHARS - suffix.length) + suffix;
    if (!taken.includes(candidate)) return candidate;
  }
}

const text = (draft: Draft, key: string) => String(draft[key] ?? "").trim();

function optionalNumber(draft: Draft, key: string): number | undefined {
  const value = text(draft, key);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${key.replace(/_/g, " ")} must be a whole number above 0`);
  return parsed;
}

function configOf(draft: Draft): McpHttpConfig | McpStdioConfig {
  if (draft.transport === "stdio")
    return {
      command: text(draft, "command"),
      args: parseLines(text(draft, "args")),
      env: parsePairs(text(draft, "env"), "="),
      files: parseFiles(String(draft.files ?? "")),
    };
  return {
    url: text(draft, "url"),
    headers: parsePairs(text(draft, "headers"), ":"),
  };
}

/** Fixed when a server is created; the form does not show them. */
export interface ServerIdentity {
  slug: string;
  toolPrefix: string;
}

/** The POST body for a draft. Throws with a message the form can show. */
export function serverPayload(
  draft: Draft,
  identity: ServerIdentity,
  teams: string[],
) {
  return {
    slug: identity.slug,
    name: text(draft, "name"),
    transport: draft.transport === "stdio" ? "stdio" : "http",
    config: configOf(draft),
    credentialMode:
      draft.credential_mode === "personal" ? "personal" : "shared",
    toolPrefix: identity.toolPrefix,
    rateWindows: parseWindows(text(draft, "rate_windows")),
    rateLimitCodes: parseCodes(text(draft, "rate_limit_codes")),
    argumentBindings: parsePairs(text(draft, "argument_bindings"), "="),
    resultMaxChars: optionalNumber(draft, "result_max_chars"),
    callTimeoutMs: optionalNumber(draft, "call_timeout_ms"),
    redaction: Boolean(draft.redaction),
    enabled: draft.enabled !== false,
    note: text(draft, "note") || null,
    teams,
  };
}

export const httpConfig = (row: McpServerRow) =>
  row.transport === "http" ? (row.config as McpHttpConfig) : null;

export const stdioConfig = (row: McpServerRow) =>
  row.transport === "stdio" ? (row.config as McpStdioConfig) : null;
