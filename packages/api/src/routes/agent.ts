import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir, homedir } from "node:os";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  badInput,
  notFound,
  forbidden,
  recordRun,
  env,
  envVarName,
  effectiveSettings,
  getUserByEmail,
  userSoleTeamId,
  effectivePrefs,
  resolveCredential,
  resolveAgentAuth,
  secretsEnabled,
  listSourceConnections,
  sourceCredentialName,
  getArtifact,
  listVisibleArtifacts,
  renderColumnContract,
  type ArtifactSpec,
  type EffectiveSettings,
  type ScopeContext,
} from "@tachy/core";
import { startTurn, type AgentConfig, type AgentTurn } from "@tachy/agent";
import { sessionEmail } from "../auth";
import { BUILTIN_COMMANDS, findCommand, commandAutoApprove } from "../commands";

interface TurnEntry {
  turn: AgentTurn;
  email?: string;
  startedAt: number;
}

const turns = new Map<string, TurnEntry>();
const TURN_TTL_MS = 60 * 60_000;

// A dropped SSE stream must not orphan a running turn: entries stay approvable
// until the turn finishes on its own (approvals time out in the agent layer),
// and this sweep reaps anything that outlives the TTL.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of turns) {
    if (entry.turn.finished) turns.delete(id);
    else if (now - entry.startedAt > TURN_TTL_MS) {
      entry.turn.abort();
      turns.delete(id);
    }
  }
}, 60_000);
sweep.unref?.();

const uploadDir =
  process.env.TACHY_UPLOAD_DIR || join(tmpdir(), "tachy-uploads");
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

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
async function systemPrompt(): Promise<string> {
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
async function userConfigDir(userId: string | undefined): Promise<string> {
  const home = process.env.TACHY_AGENT_HOME || join(homedir(), ".claude");
  const dir = join(home, "users", userId ?? "_default");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export async function mcpConfig(
  userEmail: string | undefined,
  settings: EffectiveSettings,
): Promise<Omit<AgentConfig, "systemPromptAppend">> {
  const mcpEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (typeof v === "string") mcpEnv[k] = v;
  if (userEmail) mcpEnv.TACHY_USER_EMAIL = userEmail;
  if (settings.redaction_global.value) mcpEnv.TACHY_REDACT = "true";

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
  if (secretsEnabled()) {
    for (const conn of await listSourceConnections()) {
      const token = await resolveCredential(
        sourceCredentialName(conn.source_type, conn.slug),
        ctx,
      );
      if (token !== undefined)
        mcpEnv[
          `${envVarName(conn.source_type)}_TOKEN_${envVarName(conn.slug)}`
        ] = token;
    }
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

  const allowedModels = settings.allowed_models.value;
  return {
    provider,
    mcpCommand: command,
    mcpArgs: args,
    mcpEnv,
    cwd: process.cwd(),
    configDir,
    model: prefs.agent_model.value,
    effort: prefs.agent_effort.value as AgentConfig["effort"],
    ...(agentAuth ? { agentAuth } : {}),
    ...(allowedModels.length ? { allowedModels } : {}),
  };
}

const chatSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  uploadPaths: z.array(z.string()).optional(),
  artifactId: z.string().optional(),
  command: z
    .object({ name: z.string(), args: z.string().default("") })
    .optional(),
});

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
      `The user uploaded these local files for you to analyze with the ingest_context tool: ${i.uploadPaths.join(", ")}.`,
    );
  parts.push(i.message);
  return parts.join("\n\n");
}

/**
 * Typing a command and attaching an artifact are both user actions, so the tools
 * each one exists to run are pre-authorised. Never keyed on the model's choice.
 */
function turnAutoApprove(
  commandName: string | undefined,
  spec: ArtifactSpec | null | undefined,
): string[] {
  return [
    ...(commandName ? commandAutoApprove(commandName) : []),
    ...(spec?.utilities ?? []),
  ];
}

const approveSchema = z.object({
  turnId: z.string(),
  id: z.string(),
  approve: z.boolean(),
  message: z.string().optional(),
  updatedInput: z.record(z.string(), z.any()).optional(),
});

export const agent = new Hono()

  .get("/commands", async (c) => {
    const userEmail = (await sessionEmail(c)) ?? env.userEmail;
    const user = userEmail ? await getUserByEmail(userEmail) : null;
    const ctx: ScopeContext = user
      ? {
          userId: user.id,
          teamId: (await userSoleTeamId(user.id)) ?? undefined,
        }
      : {};
    return c.json({
      builtins: BUILTIN_COMMANDS.map(({ name, args, description }) => ({
        name,
        args,
        description,
      })),
      artifacts: await listVisibleArtifacts(ctx),
    });
  })

  .post("/chat", zValidator("json", chatSchema), async (c) => {
    const { message, sessionId, uploadPaths, artifactId, command } =
      c.req.valid("json");
    const userEmail = (await sessionEmail(c)) ?? env.userEmail;

    let artifact: Awaited<ReturnType<typeof getArtifact>> | undefined;
    if (artifactId) {
      const user = userEmail ? await getUserByEmail(userEmail) : null;
      const ctx: ScopeContext = user
        ? {
            userId: user.id,
            teamId: (await userSoleTeamId(user.id)) ?? undefined,
          }
        : {};
      artifact = await getArtifact(artifactId, ctx);
    }
    const prompt = buildPrompt({ message, uploadPaths, artifact, command });

    const autoApprove = turnAutoApprove(command?.name, artifact?.spec);

    const cfg: AgentConfig = {
      ...(await mcpConfig(userEmail, await effectiveSettings())),
      systemPromptAppend: await systemPrompt(),
      ...(autoApprove.length ? { autoApprove } : {}),
    };
    const user = userEmail ? await getUserByEmail(userEmail) : null;
    const turnId = randomUUID();
    const turn = startTurn(prompt, cfg, sessionId ? { resume: sessionId } : {});
    turns.set(turnId, { turn, email: userEmail, startedAt: Date.now() });

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: "start",
        data: JSON.stringify({ turnId }),
      });
      try {
        for await (const ev of turn.events()) {
          if (ev.type === "result") {
            await recordRun({
              mode: "chat",
              userId: user?.id ?? null,
              model: cfg.model,
              inputTokens: ev.usage?.inputTokens ?? undefined,
              outputTokens: ev.usage?.outputTokens ?? undefined,
              meta: {
                provider: cfg.provider,
                session_id: ev.sessionId,
                cost_usd: ev.costUsd,
                ...(ev.usage?.premiumRequests != null
                  ? { premium_requests: ev.usage.premiumRequests }
                  : {}),
              },
            }).catch(() => {});
          }
          await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
        }
      } finally {
        if (turn.finished) turns.delete(turnId);
      }
    });
  })

  .post("/approve", zValidator("json", approveSchema), async (c) => {
    const { turnId, id, approve, message, updatedInput } = c.req.valid("json");
    const entry = turns.get(turnId);
    if (!entry) throw notFound("unknown or finished turn");
    const email = (await sessionEmail(c)) ?? env.userEmail;
    if (entry.email && entry.email !== email)
      throw forbidden("only the user who started this turn can approve it");
    entry.turn.approve(id, { approve, message, updatedInput });
    return c.json({ ok: true });
  })

  .post("/uploads", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw badInput("expected a 'file' field");
    if (file.size > MAX_UPLOAD_BYTES)
      throw badInput("file too large (max 25 MB)");
    await mkdir(uploadDir, { recursive: true });
    const safe = `${randomUUID()}-${basename(file.name || "upload")}`;
    const path = join(uploadDir, safe);
    await writeFile(path, Buffer.from(await file.arrayBuffer()));
    return c.json({ path, filename: file.name });
  });
