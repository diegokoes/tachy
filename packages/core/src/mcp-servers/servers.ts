import { isAbsolute, normalize } from "node:path";
import {
  MCP_CREDENTIAL_MODES,
  MCP_TOKEN_CREDENTIAL,
  MCP_TRANSPORTS,
  SLUG_RE,
  TOOL_PREFIX_RE,
  isMcpServerUrl,
  type McpCredentialMode,
  type McpHttpConfig,
  type McpServerRow,
  type McpStdioConfig,
  type McpTransport,
  type RateWindow,
} from "@tachy/contract";
import { sql, jsonb, type Db } from "../infra/db";
import { badInput, conflict, notFound } from "../infra/errors";

export interface McpServerInput {
  slug: string;
  name: string;
  transport: McpTransport;
  config: McpHttpConfig | McpStdioConfig;
  credentialMode: McpCredentialMode;
  toolPrefix: string;
  rateWindows?: RateWindow[];
  rateLimitCodes?: number[];
  argumentBindings?: Record<string, string>;
  resultMaxChars?: number;
  callTimeoutMs?: number;
  redaction?: boolean;
  enabled?: boolean;
  note?: string | null;
  /** Team slugs; empty means everyone. */
  teams?: string[];
}

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** From TACHY_MCP_STDIO_COMMANDS: in the host env, so the console cannot start arbitrary programs. */
export function allowedStdioCommands(): string[] {
  return (process.env.TACHY_MCP_STDIO_COMMANDS ?? "")
    .split(",")
    .map((command) => command.trim())
    .filter(Boolean);
}

export function assertStdioCommandAllowed(command: string): void {
  if (allowedStdioCommands().includes(command)) return;
  throw badInput(
    `'${command}' is not on this host's list of MCP server commands (TACHY_MCP_STDIO_COMMANDS)`,
  );
}

function assertStringRecord(value: unknown, what: string, keyRe: RegExp): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw badInput(`${what} must be an object of strings`);
  for (const [key, entry] of Object.entries(value)) {
    if (!keyRe.test(key)) throw badInput(`${what}: invalid name '${key}'`);
    if (typeof entry !== "string")
      throw badInput(`${what}: '${key}' must be a string`);
  }
}

function assertHttpConfig(config: McpHttpConfig): void {
  if (typeof config.url !== "string" || !isMcpServerUrl(config.url))
    throw badInput(
      "an http server needs an http(s) url with no credentials in it",
    );
  assertStringRecord(config.headers, "headers", HEADER_NAME_RE);
}

/** Keeps a file inside the connection's directory. */
function assertRelativePath(path: unknown): void {
  if (typeof path !== "string" || !path || isAbsolute(path))
    throw badInput("a file path must be relative");
  const normal = normalize(path);
  if (normal.startsWith(".."))
    throw badInput(`file path '${path}' leaves its directory`);
}

function assertStdioConfig(config: McpStdioConfig): void {
  if (typeof config.command !== "string" || !config.command)
    throw badInput("a stdio server needs a command");
  assertStdioCommandAllowed(config.command);
  if (
    config.args !== undefined &&
    (!Array.isArray(config.args) ||
      config.args.some((arg) => typeof arg !== "string"))
  )
    throw badInput("args must be a list of strings");
  assertStringRecord(config.env, "env", ENV_NAME_RE);
  for (const file of config.files ?? []) {
    assertRelativePath(file?.path);
    if (typeof file.content !== "string")
      throw badInput(`file '${file.path}' needs text content`);
  }
}

function assertRateWindows(windows: RateWindow[]): void {
  for (const window of windows) {
    if (!Number.isInteger(window?.seconds) || window.seconds < 1)
      throw badInput("a rate window's seconds must be a whole number above 0");
    if (!Number.isInteger(window.limit) || window.limit < 1)
      throw badInput("a rate window's limit must be a whole number above 0");
  }
}

export function assertServerInput(input: McpServerInput): void {
  if (!SLUG_RE.test(input.slug))
    throw badInput(
      `invalid server slug '${input.slug}': lowercase letters, digits and hyphens only`,
    );
  if (!input.name?.trim()) throw badInput("a server needs a name");
  if (!TOOL_PREFIX_RE.test(input.toolPrefix))
    throw badInput(
      "the tool prefix is up to 20 lowercase letters, digits or _, starting with a letter",
    );
  if (!MCP_TRANSPORTS.includes(input.transport))
    throw badInput(`unknown transport '${input.transport}'`);
  if (!MCP_CREDENTIAL_MODES.includes(input.credentialMode))
    throw badInput(`unknown credential mode '${input.credentialMode}'`);
  if (input.transport === "http")
    assertHttpConfig(input.config as McpHttpConfig);
  else assertStdioConfig(input.config as McpStdioConfig);
  assertRateWindows(input.rateWindows ?? []);
  if ((input.rateLimitCodes ?? []).some((code) => !Number.isInteger(code)))
    throw badInput("rate-limit codes must be whole numbers");
  for (const [argument, kind] of Object.entries(input.argumentBindings ?? {}))
    if (!argument || typeof kind !== "string" || !kind.trim())
      throw badInput(`binding '${argument}' needs a customer fact kind`);
}

const SERVER_COLUMNS = sql`
  s.id, s.slug, s.name, s.transport, s.config, s.credential_mode, s.tool_prefix,
  s.rate_windows, s.rate_limit_codes, s.argument_bindings, s.result_max_chars,
  s.call_timeout_ms, s.redaction, s.enabled, s.note, s.tools_refreshed_at,
  s.created_at,
  coalesce((
    select json_agg(json_build_object('slug', t.slug, 'name', t.name) order by t.slug)
    from mcp_server_teams st join teams t on t.id = st.team_id
    where st.server_id = s.id
  ), '[]'::json) as teams,
  (select count(*)::int from mcp_server_tools x where x.server_id = s.id) as tools,
  (select count(*)::int from mcp_server_tools x
     where x.server_id = s.id and x.exposed) as exposed
`;

export async function listMcpServers(): Promise<McpServerRow[]> {
  const rows = await sql`
    select ${SERVER_COLUMNS} from mcp_servers s order by s.name
  `;
  return rows as unknown as McpServerRow[];
}

export async function getMcpServer(slug: string): Promise<McpServerRow> {
  const [row] = await sql`
    select ${SERVER_COLUMNS} from mcp_servers s where s.slug = ${slug}
  `;
  if (!row) throw notFound(`MCP server '${slug}' not found`);
  return row as unknown as McpServerRow;
}

async function setServerTeams(db: Db, serverId: string, teams: string[]) {
  const slugs = [...new Set(teams)];
  const found = await db`select id, slug from teams where slug = any(${slugs})`;
  const missing = slugs.filter((s) => !found.some((t) => t.slug === s));
  if (missing.length) throw badInput(`unknown team: ${missing.join(", ")}`);
  await db`delete from mcp_server_teams where server_id = ${serverId}`;
  if (found.length)
    await db`
      insert into mcp_server_teams (server_id, team_id)
      select ${serverId}, unnest(${found.map((t) => t.id as string)}::uuid[])
    `;
}

/** Creates, or replaces all settings of, the server with this slug. */
export async function saveMcpServer(
  input: McpServerInput,
  userId: string | null,
): Promise<McpServerRow> {
  assertServerInput(input);
  const values = {
    name: input.name.trim(),
    transport: input.transport,
    config: jsonb(input.config),
    credential_mode: input.credentialMode,
    tool_prefix: input.toolPrefix,
    rate_windows: jsonb(input.rateWindows ?? []),
    rate_limit_codes: input.rateLimitCodes ?? [],
    argument_bindings: jsonb(input.argumentBindings ?? {}),
    result_max_chars: input.resultMaxChars ?? 60_000,
    call_timeout_ms: input.callTimeoutMs ?? 30_000,
    redaction: input.redaction ?? false,
    enabled: input.enabled ?? true,
    note: input.note?.trim() || null,
  };
  await sql.begin(async (tx) => {
    const [taken] = await tx`
      select slug from mcp_servers
      where tool_prefix = ${input.toolPrefix} and slug <> ${input.slug}
    `;
    if (taken)
      throw conflict(
        `tool prefix '${input.toolPrefix}' is already used by '${taken.slug}'`,
      );
    const [row] = await tx`
      insert into mcp_servers ${tx({ slug: input.slug, created_by: userId, ...values })}
      on conflict (slug) do update set ${tx(values)}
      returning id
    `;
    if (input.teams) await setServerTeams(tx, row.id, input.teams);
  });
  return getMcpServer(input.slug);
}

/** Also deletes its tools, budget and saved tokens. */
export async function deleteMcpServer(slug: string): Promise<void> {
  await sql.begin(async (tx) => {
    const rows =
      await tx`delete from mcp_servers where slug = ${slug} returning id`;
    if (!rows.length) throw notFound(`MCP server '${slug}' not found`);
    const name = `${MCP_TOKEN_CREDENTIAL}:${slug}`;
    await tx`
      delete from credentials
      where name = ${name} or starts_with(name, ${`${name}:`})
    `;
  });
}

/** Enabled servers with no teams or one of the person's teams. A null user gets only the former. */
export async function serversFor(
  userId: string | null,
): Promise<McpServerRow[]> {
  const rows = await sql`
    select ${SERVER_COLUMNS} from mcp_servers s
    where s.enabled and (
      not exists (select 1 from mcp_server_teams st where st.server_id = s.id)
      or exists (
        select 1 from mcp_server_teams st
        join team_members tm on tm.team_id = st.team_id
        where st.server_id = s.id and tm.user_id = ${userId}
      )
    )
    order by s.slug
  `;
  return rows as unknown as McpServerRow[];
}

export async function mcpServerCount(): Promise<number> {
  const [row] = await sql`select count(*)::int as n from mcp_servers`;
  return row!.n as number;
}
