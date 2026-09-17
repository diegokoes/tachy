import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
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
  listSourceConnections,
  sourceCredentialName,
  getArtifact,
  listVisibleArtifacts,
  renderColumnContract,
  type ArtifactSpec,
  type EffectiveSettings,
  type ScopeContext,
  saveUpload,
  sweepUploads,
  runningHeavyJobs,
  JOB_CLASS_CHAT_SLOTS,
  log,
  unavailable,
} from "@tachy/core";
import { requireCaller } from "../authz";
import { startTurn, type AgentConfig, type AgentTurn } from "@tachy/agent";
import { sessionEmail } from "../auth";
import { lifecycle } from "../lifecycle";
import { requestIdOf } from "../logging";
import {
  Admission,
  AdmissionCancelled,
  QueueFull,
  type AdmissionLimits,
} from "../admission";
import { internalEndpoint } from "../internal-endpoint";
import { BUILTIN_COMMANDS, findCommand, commandAutoApprove } from "../commands";

interface TurnEntry {
  turn: AgentTurn;
  provider: string;
  email?: string;
  startedAt: number;
  leave: () => void;
}

const turns = new Map<string, TurnEntry>();
const TURN_TTL_MS = 60 * 60_000;

// A dropped SSE stream must not orphan a running turn: entries stay approvable
// until the turn finishes on its own (approvals time out in the agent layer),
// and this sweep reaps anything that outlives the TTL.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of turns) {
    if (entry.turn.finished) {
      turns.delete(id);
      entry.leave();
    } else if (now - entry.startedAt > TURN_TTL_MS) {
      entry.turn.abort();
      turns.delete(id);
      entry.leave();
    }
  }
}, 60_000);
sweep.unref?.();

let limits: AdmissionLimits = { cap: 15, queueMax: 10 };
/** Chat slots held by heavy jobs running now, in any process. */
let jobSlots = 0;
export const admission = new Admission(() => ({
  ...limits,
  cap: Math.max(1, limits.cap - jobSlots),
}));

const jobPoll = setInterval(() => {
  runningHeavyJobs()
    .then((n) => (jobSlots = n * JOB_CLASS_CHAT_SLOTS.heavy))
    .catch(() => {});
}, 10_000);
jobPoll.unref?.();

/** User key → the turn that user has running or waiting, at most one. */
const activeByUser = new Map<string, string>();

/** Turns still waiting for a slot, so /stop can take them out of the queue. */
const waiting = new Map<string, { email?: string; leave: () => void }>();

const ABANDONED_MS = 30_000;
const KEEPALIVE_MS = 20_000;

export function turnStats() {
  const byProvider: Record<string, number> = {};
  let pendingApprovals = 0;
  let oldestApprovalAt: number | null = null;
  for (const { turn, provider } of turns.values()) {
    if (turn.finished) continue;
    byProvider[provider] = (byProvider[provider] ?? 0) + 1;
    pendingApprovals += turn.pendingApprovals;
    const at = turn.oldestPendingApprovalAt;
    if (at !== null && (oldestApprovalAt === null || at < oldestApprovalAt))
      oldestApprovalAt = at;
  }
  return {
    ...admission.stats,
    running: byProvider,
    pendingApprovals,
    oldestApprovalAgeSeconds:
      oldestApprovalAt === null
        ? null
        : Math.round((Date.now() - oldestApprovalAt) / 1000),
  };
}

export const activeTurnCount = () =>
  [...turns.values()].filter((e) => !e.turn.finished).length;

export function abortAllTurns(): number {
  let aborted = 0;
  for (const entry of turns.values())
    if (!entry.turn.finished) {
      entry.turn.abort();
      aborted++;
    }
  return aborted;
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const uploadSweep = setInterval(() => {
  sweepUploads()
    .then((removed) => removed && log("info", "uploads_sweep", { removed }))
    .catch((err) => log("error", "uploads_sweep", { error: String(err) }));
}, 60 * 60_000);
uploadSweep.unref?.();

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
): Promise<Omit<AgentConfig, "systemPromptAppend">> {
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
      `The user attached these files for you to analyze with the ingest_context tool: ${i.uploadPaths.join(", ")}.`,
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
    if (lifecycle.draining) {
      c.header("Retry-After", "30");
      throw unavailable("the server is restarting; try again in a moment");
    }
    if (lifecycle.refusingChats) {
      c.header("Retry-After", "300");
      throw unavailable(
        "chat is paused for maintenance; everything else keeps working",
      );
    }
    const { message, sessionId, uploadPaths, artifactId, command } =
      c.req.valid("json");
    const userEmail = (await sessionEmail(c)) ?? env.userEmail;
    const userKey = userEmail ?? "anonymous";

    const running = activeByUser.get(userKey);
    if (running)
      return c.json(
        {
          error: "you already have a chat turn running; stop it or wait for it",
          turnId: running,
        },
        409,
      );

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

    // Minted before the config so the MCP subprocess can carry it: a knowledge
    // edit made mid-turn records which conversation made it.
    const turnId = randomUUID();
    const settings = await effectiveSettings();
    const base = await mcpConfig(userEmail, settings, turnId);
    const requestId = requestIdOf(c);
    if (requestId) base.mcpEnv.TACHY_REQUEST_ID = requestId;
    const cfg: AgentConfig = {
      ...base,
      systemPromptAppend: await systemPrompt(),
      ...(autoApprove.length ? { autoApprove } : {}),
    };
    const user = userEmail ? await getUserByEmail(userEmail) : null;

    if (activeByUser.has(userKey))
      return c.json(
        {
          error: "you already have a chat turn running; stop it or wait for it",
          turnId: activeByUser.get(userKey),
        },
        409,
      );
    limits = {
      cap: settings.agent_slot_cap.value,
      queueMax: settings.agent_queue_max.value,
    };
    const weight =
      cfg.provider === "copilot" ? settings.copilot_slot_weight.value : 1;
    let ticket;
    try {
      ticket = admission.admit(weight);
    } catch (err) {
      if (!(err instanceof QueueFull)) throw err;
      c.header("Retry-After", "30");
      return c.json({ error: err.message }, 429);
    }
    activeByUser.set(userKey, turnId);
    const leave = () => {
      ticket.release();
      waiting.delete(turnId);
      if (activeByUser.get(userKey) === turnId) activeByUser.delete(userKey);
    };
    if (ticket.position > 0) waiting.set(turnId, { email: userEmail, leave });

    return streamSSE(c, async (stream) => {
      let streamOpen = true;
      let turn: AgentTurn | undefined;
      const send = (event: string, data: unknown) =>
        streamOpen
          ? stream
              .writeSSE({ event, data: JSON.stringify(data) })
              .catch(() => void (streamOpen = false))
          : Promise.resolve();
      const keepalive = setInterval(() => {
        if (streamOpen) stream.write(": keepalive\n\n").catch(() => {});
      }, KEEPALIVE_MS);
      keepalive.unref?.();

      // A closed stream cannot show an approval card, so a turn left with none
      // pending is stopped rather than run to the one-hour TTL unseen.
      stream.onAbort(() => {
        streamOpen = false;
        if (!turn) return leave();
        const watch = setInterval(() => {
          if (!turn || turn.finished) return clearInterval(watch);
          if (turn.pendingApprovals === 0) {
            turn.abort();
            clearInterval(watch);
          }
        }, ABANDONED_MS);
        watch.unref?.();
      });

      try {
        await send("start", { turnId });
        if (ticket.position > 0)
          await send("queued", { position: ticket.position });
        try {
          await ticket.granted;
        } catch (err) {
          if (!(err instanceof AdmissionCancelled)) throw err;
          await send("error", { type: "error", message: "Stopped." });
          return;
        }
        waiting.delete(turnId);
        if (!streamOpen) return;
        if (lifecycle.draining) {
          await send("error", {
            type: "error",
            message: "the server is restarting; try again in a moment",
          });
          return;
        }

        turn = startTurn(prompt, cfg, sessionId ? { resume: sessionId } : {});
        turns.set(turnId, {
          turn,
          provider: cfg.provider,
          email: userEmail,
          startedAt: Date.now(),
          leave,
        });
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
                turn_id: turnId,
                session_id: ev.sessionId,
                cost_usd: ev.costUsd,
                ...(ev.usage?.premiumRequests != null
                  ? { premium_requests: ev.usage.premiumRequests }
                  : {}),
              },
            }).catch(() => {});
          }
          await send(ev.type, ev);
        }
      } finally {
        clearInterval(keepalive);
        if (!turn || turn.finished) {
          turns.delete(turnId);
          leave();
        }
      }
    });
  })

  .post(
    "/stop",
    zValidator("json", z.object({ turnId: z.string() })),
    async (c) => {
      const { turnId } = c.req.valid("json");
      const email = (await sessionEmail(c)) ?? env.userEmail;
      const owner = turns.get(turnId) ?? waiting.get(turnId);
      if (!owner) throw notFound("unknown or finished turn");
      if (owner.email !== email)
        throw forbidden("only the user who started this turn can stop it");
      const entry = turns.get(turnId);
      if (entry) entry.turn.abort();
      else owner.leave();
      return c.json({ ok: true });
    },
  )

  .post("/approve", zValidator("json", approveSchema), async (c) => {
    const { turnId, id, approve, message, updatedInput } = c.req.valid("json");
    const entry = turns.get(turnId);
    if (!entry) throw notFound("unknown or finished turn");
    const email = (await sessionEmail(c)) ?? env.userEmail;
    // A turn that resolved no email is answerable by whoever started it and
    // nobody else; without the first clause an unattributed turn was open to
    // anyone who guessed its id.
    if (entry.email !== email)
      throw forbidden("only the user who started this turn can approve it");
    entry.turn.approve(id, { approve, message, updatedInput });
    return c.json({ ok: true });
  })

  .post("/uploads", async (c) => {
    const owner = await requireCaller(c);
    // Checked before parseBody, which buffers the whole request first: past
    // that point the limit has already been paid for in memory.
    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > MAX_UPLOAD_BYTES)
      throw badInput("file too large (max 25 MB)");
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw badInput("expected a 'file' field");
    if (file.size > MAX_UPLOAD_BYTES)
      throw badInput("file too large (max 25 MB)");
    const filename = basename(file.name || "upload");
    const { ref } = await saveUpload({
      userId: owner,
      filename,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return c.json({ path: ref, filename: file.name });
  });
