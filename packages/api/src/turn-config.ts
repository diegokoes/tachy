import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { badInput, envVarName, rememberSecret } from "@tachy/core/infra";
import {
  dateFormatOf,
  effectivePrefs,
  resolveCredential,
  resolveAgentAuth,
  sourceCredentialName,
  type EffectiveSettings,
  type ScopeContext,
} from "@tachy/core/config";
import {
  encodeDateFormat,
  formatDateTime,
  DEFAULT_DATE_FORMAT,
  type DateFormat,
} from "@tachy/core";
import { getUserByEmail, userSoleTeamId } from "@tachy/core/access";
import { listSourceConnections } from "@tachy/core/sources";
import { ANONYMOUS_UPLOADS } from "@tachy/core/chat";
import { renderColumnContract, type ArtifactSpec } from "@tachy/core/exports";
import { userStateDir, type AgentConfig } from "@tachy/agent";
import { internalEndpoint } from "./internal-endpoint";
import { findCommand, commandAutoApprove } from "./commands";

/**
 * The review box invariant lives in prompt.md, where the tool descriptions
 * agree with it. This only names the surface it renders on: anything more
 * would restate instructions the model already has, on every turn.
 */
const UI_APPROVAL_NOTE = `

## Web chat

The review box named in the invariants renders here as an editable form, one per write tool call. The user edits the fields before approving, and the tool runs with their edits.`;

/**
 * Byte-identical on every turn, which lets prompt caching amortise it: no
 * per-turn state (time, user, session) is interpolated, since a varying prefix
 * invalidates the cache. Not the root CLAUDE.md, which also loads into every
 * Claude Code session opened on this repo. What belongs to one tool goes in
 * that tool's MCP description.
 */
export async function systemPrompt(): Promise<string> {
  const path = join(process.cwd(), "packages/agent/prompt.md");
  const base = existsSync(path) ? await readFile(path, "utf8") : "";
  return base + UI_APPROVAL_NOTE;
}

/**
 * Per-user Claude Code state directory. Without it every turn falls back to
 * whatever login the server itself holds, so users share one identity and one
 * pool of session transcripts. Created once and reused: a fresh directory
 * mints a new machine identity and orphans the transcripts `resume` needs.
 */
export async function userConfigDir(
  userId: string | undefined,
): Promise<string> {
  const dir = userStateDir(userId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * What the MCP subprocess inherits from the server, named rather than copied.
 * The subprocess runs on behalf of one caller, so anything the server holds for
 * everyone - the vault key, the session and API secrets, the OIDC client
 * secret, the server's own agent and source tokens - must not travel with it.
 * A copy-then-delete list would grow a hole every time a new secret is added.
 */
const INHERITED_ENV = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  "NODE_ENV",
  "DATABASE_URL",
  "LOG_LEVEL",
  "TACHY_REPO_DIR",
  "TACHY_MODEL_CACHE",
  "TACHY_EMBED_MODEL",
  "TACHY_OUTPUT_TTL_HOURS",
  // Set per test worker; the subprocess reads the same schema as its parent.
  "TEST_SCHEMA",
];

/**
 * Where the chat tools connect. With TACHY_MCP_DB_PASSWORD set that is the same
 * database as the least-privileged tachy_mcp role (db/roles.sql); without it,
 * the server's own connection, which is all a single-role database has.
 */
export function toolsDatabaseUrl(serverUrl: string): string {
  const password = rememberSecret(process.env.TACHY_MCP_DB_PASSWORD);
  if (!password) return serverUrl;
  const url = new URL(serverUrl);
  url.username = "tachy_mcp";
  url.password = password;
  return url.toString();
}

export async function mcpConfig(
  userEmail: string | undefined,
  settings: EffectiveSettings,
  turn: { id?: string; actorRole?: "admin" } = {},
): Promise<Omit<AgentConfig, "systemPrompt">> {
  const mcpEnv: Record<string, string> = {};
  for (const name of INHERITED_ENV) {
    const value = process.env[name];
    if (typeof value === "string") mcpEnv[name] = value;
  }
  if (mcpEnv.DATABASE_URL)
    mcpEnv.DATABASE_URL = toolsDatabaseUrl(mcpEnv.DATABASE_URL);
  mcpEnv.TACHY_DB_POOL_MAX = "2";
  mcpEnv.TACHY_DB_IDLE_TIMEOUT = "30";
  mcpEnv.TACHY_DB_APP_NAME = "tachy-mcp";
  if (internalEndpoint) {
    mcpEnv.TACHY_EMBED_URL =
      internalEndpoint.embedUrl ?? `${internalEndpoint.baseUrl}/embed`;
    mcpEnv.TACHY_LOG_URL = `${internalEndpoint.baseUrl}/log`;
    mcpEnv.TACHY_INTERNAL_SECRET = internalEndpoint.secret;
  }
  if (userEmail) mcpEnv.TACHY_USER_EMAIL = userEmail;
  // Lets a write made during a turn be told apart from one made by someone
  // pointing their own MCP client at tachy, and links it back to the run.
  if (turn.id) {
    mcpEnv.TACHY_ACTOR = "agent";
    mcpEnv.TACHY_TURN_ID = turn.id;
  }
  if (turn.actorRole) mcpEnv.TACHY_ACTOR_ROLE = turn.actorRole;
  if (settings.redaction_global.value) mcpEnv.TACHY_REDACT = "true";

  mcpEnv.NODE_OPTIONS = "--max-old-space-size=256";

  const command = process.env.TACHY_MCP_COMMAND || process.execPath;
  const mcpArgs = process.env.TACHY_MCP_ARGS
    ? process.env.TACHY_MCP_ARGS.split(" ")
    : ["--import", "tsx", "packages/mcp/src/index.ts"];

  const user = userEmail ? await getUserByEmail(userEmail) : null;
  const ctx: ScopeContext = user
    ? { userId: user.id, teamId: (await userSoleTeamId(user.id)) ?? undefined }
    : {};
  // Caller-scoped tokens are safe only because this env is built fresh for each
  // turn's MCP subprocess: never pool or share it across users. Resolved here:
  // the child has no TACHY_SECRET_KEY, and an empty scope reads the org-wide row.
  for (const conn of await listSourceConnections()) {
    const token = await resolveCredential(
      sourceCredentialName(conn.source_type, conn.slug),
      ctx,
    );
    if (token !== undefined)
      mcpEnv[`${envVarName(conn.source_type)}_TOKEN_${envVarName(conn.slug)}`] =
        token;
  }

  if (user)
    mcpEnv.TACHY_DATE_FORMAT = encodeDateFormat(await dateFormatOf(ctx));

  const prefs = user
    ? await effectivePrefs(ctx)
    : {
        agent_model: settings.agent_model,
        agent_effort: settings.agent_effort,
      };
  const agentAuth = await resolveAgentAuth(ctx);
  const configDir = await userConfigDir(user?.id);
  mcpEnv.TACHY_UPLOAD_OWNER = user?.id ?? ANONYMOUS_UPLOADS;

  const allowedModels = settings.allowed_models.value;
  return {
    mcpCommand: command,
    mcpArgs,
    mcpEnv,
    cwd: process.cwd(),
    configDir,
    model: prefs.agent_model.value,
    effort: prefs.agent_effort.value as AgentConfig["effort"],
    ...(agentAuth ? { agentAuth } : {}),
    ...(allowedModels.length ? { allowedModels } : {}),
  };
}

const SAMPLE_DATE = "2026-09-29T14:05:00Z";

/**
 * Said only to a user who changed the format, and in their message rather than
 * the system prompt, which must stay identical for every turn to be cached.
 */
function dateNote(format: DateFormat | undefined): string | undefined {
  if (
    !format ||
    (format.order === DEFAULT_DATE_FORMAT.order &&
      format.clock === DEFAULT_DATE_FORMAT.clock)
  )
    return undefined;
  return `This user reads dates like ${formatDateTime(SAMPLE_DATE, format)} (UTC): use that in replies, and keep ISO in anything you save.`;
}

export function buildPrompt(input: {
  message: string;
  uploadPaths?: string[];
  artifact?: {
    slug?: string;
    title: string;
    body: string;
    spec?: ArtifactSpec | null;
  };
  command?: { name: string; args: string };
  dateFormat?: DateFormat;
}): string {
  const parts: string[] = [];
  if (input.command) {
    const cmd = findCommand(input.command.name);
    if (!cmd) throw badInput(`unknown command '/${input.command.name}'`);
    parts.push(
      `<command name="${cmd.name}">\n${cmd.expand(input.command.args)}\n</command>\n\nThe block above is an authoritative mode selector triggered by the user typing /${cmd.name} - follow it without re-deciding what mode applies.`,
    );
  }
  if (input.artifact) {
    parts.push(
      `<artifact title=${JSON.stringify(input.artifact.title)}>\n${input.artifact.body}\n</artifact>\n\nThe block above is reusable context the user attached to this message; treat it as instructions/context, not as the user's question.`,
    );
    const output = input.artifact.spec?.output;
    if (output && input.artifact.slug)
      parts.push(renderColumnContract(input.artifact.slug, output));
  }
  if (input.uploadPaths?.length)
    parts.push(
      `The user attached these files for you to analyze with the ingest_context tool: ${input.uploadPaths.join(", ")}.`,
    );
  const note = dateNote(input.dateFormat);
  if (note) parts.push(note);
  parts.push(input.message);
  return parts.join("\n\n");
}

/**
 * Typing a command and attaching an artifact are both user actions, so the tools
 * each one exists to run are pre-authorised. Never keyed on the model's choice.
 */
export function turnAutoApprove(
  commandName: string | undefined,
  spec: ArtifactSpec | null | undefined,
): string[] {
  return [
    ...(commandName ? commandAutoApprove(commandName) : []),
    ...(spec?.utilities ?? []),
  ];
}
