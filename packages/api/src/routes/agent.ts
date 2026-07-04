import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { env } from "@tachy/core";
import { startTurn, type AgentConfig, type AgentTurn } from "@tachy/agent";
import { sessionEmail } from "../auth";

// Active turns, keyed by turnId, so the separate /approve request can reach the
// turn that raised the approval. Entries are removed when the turn ends.
const turns = new Map<string, AgentTurn>();

const uploadDir = process.env.TACHY_UPLOAD_DIR || join(tmpdir(), "tachy-uploads");

// Cost policy: default Sonnet at medium effort, optional model allowlist — all env-overridable.
const model = process.env.TACHY_AGENT_MODEL || "claude-sonnet-5";
const allowedModels = (process.env.TACHY_ALLOWED_MODELS ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const effort = (["low", "medium", "high", "xhigh", "max"].includes(process.env.TACHY_AGENT_EFFORT ?? "")
  ? process.env.TACHY_AGENT_EFFORT
  : "medium") as AgentConfig["effort"];

let systemPromptCache: string | undefined;
async function systemPrompt(): Promise<string> {
  if (systemPromptCache === undefined) {
    const path = join(process.cwd(), "CLAUDE.md");
    systemPromptCache = existsSync(path) ? await readFile(path, "utf8") : "";
  }
  return systemPromptCache;
}

// Launch config for the tachy MCP subprocess: inherits env (DB, source tokens)
// plus the logged-in user's email for attribution.
function mcpConfig(userEmail: string | undefined): Omit<AgentConfig, "systemPromptAppend"> {
  const mcpEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") mcpEnv[k] = v;
  if (userEmail) mcpEnv.TACHY_USER_EMAIL = userEmail;

  const command = process.env.TACHY_MCP_COMMAND || process.execPath;
  const args = process.env.TACHY_MCP_ARGS
    ? process.env.TACHY_MCP_ARGS.split(" ")
    : ["--import", "tsx", "packages/mcp/src/index.ts"];

  return {
    mcpCommand: command, mcpArgs: args, mcpEnv, cwd: process.cwd(),
    model, effort, ...(allowedModels.length ? { allowedModels } : {}),
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
  // Streamed agent turn. Emits SSE events: start, text, tool_use, approval_request,
  // approval_resolved, result, error. The client relays approvals via /agent/approve.
  .post("/chat", zValidator("json", chatSchema), async (c) => {
    const { message, sessionId, uploadPaths } = c.req.valid("json");
    const userEmail = (await sessionEmail(c)) ?? env.userEmail;

    const prompt = uploadPaths?.length
      ? `The user uploaded these local files for you to analyze with the ingest_context tool: ${uploadPaths.join(
          ", ",
        )}.\n\n${message}`
      : message;

    const cfg: AgentConfig = { ...mcpConfig(userEmail), systemPromptAppend: await systemPrompt() };
    const turnId = randomUUID();
    const turn = startTurn(prompt, cfg, sessionId ? { resume: sessionId } : {});
    turns.set(turnId, turn);

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: "start", data: JSON.stringify({ turnId }) });
      try {
        for await (const ev of turn.events()) {
          await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
        }
      } finally {
        turns.delete(turnId);
      }
    });
  })

  // Resolve a pending write approval from the UI.
  .post("/approve", zValidator("json", approveSchema), (c) => {
    const { turnId, id, approve, message, updatedInput } = c.req.valid("json");
    const turn = turns.get(turnId);
    if (!turn) return c.json({ error: "unknown or finished turn" }, 404);
    turn.approve(id, { approve, message, updatedInput });
    return c.json({ ok: true });
  })

  // Accept a document upload; returns a server path to hand to the agent for ingest.
  .post("/uploads", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "expected a 'file' field" }, 400);
    await mkdir(uploadDir, { recursive: true });
    const safe = `${randomUUID()}-${basename(file.name || "upload")}`;
    const path = join(uploadDir, safe);
    await writeFile(path, Buffer.from(await file.arrayBuffer()));
    return c.json({ path, filename: file.name });
  });
