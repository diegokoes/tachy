import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { env, effectiveSettings, type EffectiveSettings } from "@tachy/core";
import { startTurn, type AgentConfig, type AgentTurn } from "@tachy/agent";
import { sessionEmail } from "../auth";

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

function mcpConfig(
  userEmail: string | undefined,
  settings: EffectiveSettings,
): Omit<AgentConfig, "systemPromptAppend"> {
  const mcpEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (typeof v === "string") mcpEnv[k] = v;
  if (userEmail) mcpEnv.TACHY_USER_EMAIL = userEmail;
  if (settings.redaction_global.value) mcpEnv.TACHY_REDACT = "true";

  const command = process.env.TACHY_MCP_COMMAND || process.execPath;
  const args = process.env.TACHY_MCP_ARGS
    ? process.env.TACHY_MCP_ARGS.split(" ")
    : ["--import", "tsx", "packages/mcp/src/index.ts"];

  const allowedModels = settings.allowed_models.value;
  return {
    mcpCommand: command,
    mcpArgs: args,
    mcpEnv,
    cwd: process.cwd(),
    model: settings.agent_model.value,
    effort: settings.agent_effort.value as AgentConfig["effort"],
    ...(allowedModels.length ? { allowedModels } : {}),
  };
}

const chatSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  uploadPaths: z.array(z.string()).optional(),
});

const approveSchema = z.object({
  turnId: z.string(),
  id: z.string(),
  approve: z.boolean(),
  message: z.string().optional(),
  updatedInput: z.record(z.string(), z.any()).optional(),
});

export const agent = new Hono()

  .post("/chat", zValidator("json", chatSchema), async (c) => {
    const { message, sessionId, uploadPaths } = c.req.valid("json");
    const userEmail = (await sessionEmail(c)) ?? env.userEmail;

    const prompt = uploadPaths?.length
      ? `The user uploaded these local files for you to analyze with the ingest_context tool: ${uploadPaths.join(
          ", ",
        )}.\n\n${message}`
      : message;

    const cfg: AgentConfig = {
      ...mcpConfig(userEmail, await effectiveSettings()),
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
    if (!turn) return c.json({ error: "unknown or finished turn" }, 404);
    turn.approve(id, { approve, message, updatedInput });
    return c.json({ ok: true });
  })

  .post("/uploads", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File))
      return c.json({ error: "expected a 'file' field" }, 400);
    await mkdir(uploadDir, { recursive: true });
    const safe = `${randomUUID()}-${basename(file.name || "upload")}`;
    const path = join(uploadDir, safe);
    await writeFile(path, Buffer.from(await file.arrayBuffer()));
    return c.json({ path, filename: file.name });
  });
