import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentHome,
  badInput,
  envVarName,
  getUserByEmail,
  userSoleTeamId,
  effectivePrefs,
  resolveCredential,
  resolveAgentAuth,
  listSourceConnections,
  sourceCredentialName,
  renderColumnContract,
  type ArtifactSpec,
  type EffectiveSettings,
  type ScopeContext,
} from "@tachy/core";
import type { AgentConfig } from "@tachy/agent";
import { internalEndpoint } from "./internal-endpoint";
import { findCommand, commandAutoApprove } from "./commands";

/**
 * The review box invariant lives in prompt.md, where the tool descriptions
 * agree with it. This only names the surface it renders on — anything more
 * would restate instructions the model already has, on every turn.
 */
const UI_APPROVAL_NOTE = `

## Web chat

The review box named in the invariants renders here as an editable form, one per write tool call. The user edits the fields before approving, and the tool runs with their edits.`;

/**
 * Byte-identical on every turn, which is what lets prompt caching amortise it.
 * Never interpolate per-turn state (time, user, session) in here: a varying
 * prefix invalidates the cache and multiplies what each turn consumes.
 *
 * Deliberately not the root CLAUDE.md: that file also loads into every Claude
 * Code session opened on this repo, and contributors and the agent want
 * different text. Anything belonging to a single tool belongs in that tool's
 * MCP description instead, where it ships with the tool rather than every turn.
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
/**
 * Kept empty: the Copilot runtime reads instruction files from the directory
 * its session runs in, and nothing in the repo root is written for the agent.
 */
async function emptySessionDir(): Promise<string> {
  const dir = join(tmpdir(), "tachy-agent-empty");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

async function userConfigDir(userId: string | undefined): Promise<string> {
  const dir = join(agentHome(), "users", userId ?? "_default");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * What the MCP subprocess inherits from the server, named rather than copied.
 * The subprocess runs on behalf of one caller, so anything the server holds for
 * everyone — the vault key, the session and API secrets, the OIDC client
 * secret, the server's own agent and source tokens — must not travel with it.
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

export async function mcpConfig(
  userEmail: string | undefined,
  settings: EffectiveSettings,
  turnId?: string,
): Promise<Omit<AgentConfig, "systemPrompt">> {
  const mcpEnv: Record<string, string> = {};
  for (const k of INHERITED_ENV) {
    const v = process.env[k];
    if (typeof v === "string") mcpEnv[k] = v;
  }
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
  if (turnId) {
    mcpEnv.TACHY_ACTOR = "agent";
    mcpEnv.TACHY_TURN_ID = turnId;
  }
  if (settings.redaction_global.value) mcpEnv.TACHY_REDACT = "true";

  mcpEnv.NODE_OPTIONS = "--max-old-space-size=256";

  const command = process.env.TACHY_MCP_COMMAND || process.execPath;
  const args = process.env.TACHY_MCP_ARGS
    ? process.env.TACHY_MCP_ARGS.split(" ")
    : ["--import", "tsx", "packages/mcp/src/index.ts"];

  const user = userEmail ? await getUserByEmail(userEmail) : null;
  const ctx: ScopeContext = user
    ? { userId: user.id, teamId: (await userSoleTeamId(user.id)) ?? undefined }
    : {};
  // Caller-scoped tokens are only safe here because this env is built fresh
  // for each turn's MCP subprocess — never pool or share it across users.
  //
  // Resolved here rather than in the subprocess, and unconditionally: the child
  // has no TACHY_SECRET_KEY, so its own resolveCredential falls straight to
  // these variables. Left to resolve for itself it would pass an empty scope,
  // and the `or scope = 'global'` leg of the lookup would hand every caller the
  // org-wide row instead of their own.
  for (const conn of await listSourceConnections()) {
    const token = await resolveCredential(
      sourceCredentialName(conn.source_type, conn.slug),
      ctx,
    );
    if (token !== undefined)
      mcpEnv[`${envVarName(conn.source_type)}_TOKEN_${envVarName(conn.slug)}`] =
        token;
  }

  const prefs = user
    ? await effectivePrefs(ctx)
    : {
        agent_provider: settings.agent_provider,
        agent_model: settings.agent_model,
        agent_effort: settings.agent_effort,
      };
  const provider = prefs.agent_provider.value;
  const agentAuth = await resolveAgentAuth(provider, ctx);
  const configDir = await userConfigDir(user?.id);
  mcpEnv.TACHY_UPLOAD_OWNER = user?.id ?? "_anonymous";

  const allowedModels = settings.allowed_models.value;
  return {
    provider,
    mcpCommand: command,
    mcpArgs: args,
    mcpEnv,
    cwd: process.cwd(),
    sessionCwd: await emptySessionDir(),
    configDir,
    model: prefs.agent_model.value,
    effort: prefs.agent_effort.value as AgentConfig["effort"],
    ...(agentAuth ? { agentAuth } : {}),
    ...(allowedModels.length ? { allowedModels } : {}),
  };
}

export function buildPrompt(i: {
  message: string;
  uploadPaths?: string[];
  artifact?: {
    slug?: string;
    title: string;
    body: string;
    spec?: ArtifactSpec | null;
  };
  command?: { name: string; args: string };
}): string {
  const parts: string[] = [];
  if (i.command) {
    const cmd = findCommand(i.command.name);
    if (!cmd) throw badInput(`unknown command '/${i.command.name}'`);
    parts.push(
      `<command name="${cmd.name}">\n${cmd.expand(i.command.args)}\n</command>\n\nThe block above is an authoritative mode selector triggered by the user typing /${cmd.name} — follow it without re-deciding what mode applies.`,
    );
  }
  if (i.artifact) {
    parts.push(
      `<artifact title=${JSON.stringify(i.artifact.title)}>\n${i.artifact.body}\n</artifact>\n\nThe block above is reusable context the user attached to this message; treat it as instructions/context, not as the user's question.`,
    );
    const output = i.artifact.spec?.output;
    if (output && i.artifact.slug)
      parts.push(renderColumnContract(i.artifact.slug, output));
  }
  if (i.uploadPaths?.length)
    parts.push(
      `The user attached these files for you to analyze with the ingest_context tool: ${i.uploadPaths.join(", ")}.`,
    );
  parts.push(i.message);
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
