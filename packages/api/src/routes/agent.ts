import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  badInput,
  notFound,
  env,
  envVarName,
  effectiveSettings,
  getUserByEmail,
  userSoleTeamId,
  effectivePrefs,
  resolveCredential,
  secretsEnabled,
  listSourceConnections,
  AGENT_CREDENTIALS,
  sourceCredentialName,
  getArtifact,
  listVisibleArtifacts,
  type EffectiveSettings,
  type ScopeContext,
} from "@tachy/core";
import { startTurn, type AgentConfig, type AgentTurn } from "@tachy/agent";
import { sessionEmail } from "../auth";
import { BUILTIN_COMMANDS, findCommand } from "../commands";

const turns = new Map<string, AgentTurn>();

const uploadDir =
  process.env.TACHY_UPLOAD_DIR || join(tmpdir(), "tachy-uploads");

const UI_APPROVAL_NOTE = `

## Web chat approval UI (overrides "ask before saving" above)

In this chat, every write tool call (save_knowledge_entry, update_knowledge_entry, save_reference_doc, add_component, post_private_note, …) is intercepted by a review box: the user sees your exact tool input as editable JSON and must Approve or Deny before it runs. That review box IS the user approval the rules require.

- Summarize the proposed entry briefly, then CALL the tool right away — do not ask "shall I save?" in prose first.
- The user can edit the JSON in the box before approving; the tool runs with their edited input.
- A denied call is the user declining, not an error — ask what they want changed instead of retrying.`;

let systemPromptCache: string | undefined;
async function systemPrompt(): Promise<string> {
  if (systemPromptCache === undefined) {
    const path = join(process.cwd(), "CLAUDE.md");
    const base = existsSync(path) ? await readFile(path, "utf8") : "";
    systemPromptCache = base + UI_APPROVAL_NOTE;
  }
  return systemPromptCache;
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
  const agentKey = await resolveCredential(AGENT_CREDENTIALS[provider], ctx);

  const allowedModels = settings.allowed_models.value;
  return {
    provider,
    mcpCommand: command,
    mcpArgs: args,
    mcpEnv,
    cwd: process.cwd(),
    model: prefs.agent_model.value,
    effort: prefs.agent_effort.value as AgentConfig["effort"],
    ...(agentKey ? { agentKey } : {}),
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
  artifact?: { title: string; body: string };
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
  if (i.artifact)
    parts.push(
      `<artifact title=${JSON.stringify(i.artifact.title)}>\n${i.artifact.body}\n</artifact>\n\nThe block above is reusable context the user attached to this message; treat it as instructions/context, not as the user's question.`,
    );
  if (i.uploadPaths?.length)
    parts.push(
      `The user uploaded these local files for you to analyze with the ingest_context tool: ${i.uploadPaths.join(", ")}.`,
    );
  parts.push(i.message);
  return parts.join("\n\n");
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

    let artifact: { title: string; body: string } | undefined;
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

    const cfg: AgentConfig = {
      ...(await mcpConfig(userEmail, await effectiveSettings())),
      systemPromptAppend: await systemPrompt(),
    };
    const turnId = randomUUID();
    const turn = startTurn(prompt, cfg, sessionId ? { resume: sessionId } : {});
    turns.set(turnId, turn);

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: "start",
        data: JSON.stringify({ turnId }),
      });
      try {
        for await (const ev of turn.events()) {
          await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
        }
      } finally {
        turns.delete(turnId);
      }
    });
  })

  .post("/approve", zValidator("json", approveSchema), (c) => {
    const { turnId, id, approve, message, updatedInput } = c.req.valid("json");
    const turn = turns.get(turnId);
    if (!turn) throw notFound("unknown or finished turn");
    turn.approve(id, { approve, message, updatedInput });
    return c.json({ ok: true });
  })

  .post("/uploads", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw badInput("expected a 'file' field");
    await mkdir(uploadDir, { recursive: true });
    const safe = `${randomUUID()}-${basename(file.name || "upload")}`;
    const path = join(uploadDir, safe);
    await writeFile(path, Buffer.from(await file.arrayBuffer()));
    return c.json({ path, filename: file.name });
  });
