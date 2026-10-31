import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { validate } from "../validation";
import { z } from "zod";
import {
  badInput,
  notFound,
  forbidden,
  env,
  unavailable,
} from "@tachy/core/infra";
import {
  lastSessionCostUsd,
  recordRun,
  turnCostUsd,
} from "@tachy/core/analytics";
import {
  effectiveSettings,
  dateFormatOf,
  type ScopeContext,
} from "@tachy/core/config";
import { getUserByEmail, userSoleTeamId } from "@tachy/core/access";
import { getArtifact, listVisibleArtifacts } from "@tachy/core/exports";
import {
  AGENT_EFFORTS,
  CHAT_MODES,
  MENTION_KINDS,
  fileFamily,
  uploadLimitBytes,
  uploadRef,
} from "@tachy/core";
import {
  checkMentions,
  listMentionables,
  readUpload,
  saveUpload,
  uploadLimits,
} from "@tachy/core/chat";
import { imageForModel, inspectFile, isImageFile } from "@tachy/core/files";
import {
  effectiveModel,
  startTurn,
  type AgentConfig,
  type AgentEvent,
  type AgentTurn,
} from "@tachy/agent";
import { isAdminIdentity, requireCaller } from "../authz";
import { getIdentity } from "../auth";
import { lifecycle } from "../lifecycle";
import { problem } from "../problems";
import { requestIdOf } from "../logging";
import { AdmissionCancelled, QueueFull } from "../admission";
import { BUILTIN_COMMANDS } from "../commands";
import { CHAT_MODE_LIST } from "../modes";
import { INERT_HEADERS } from "../downloads";
import { requestLimitBytes, tooLarge } from "../upload-limit";
import {
  activeByUser,
  admission,
  setAdmissionLimits,
  turns,
  waiting,
} from "../turns";
import {
  buildPrompt,
  mcpConfig,
  systemPrompt,
  turnAutoApprove,
  turnDebug,
  turnChoice,
} from "../turn-config";

const ABANDONED_MS = 30_000;
const KEEPALIVE_MS = 20_000;

const MAX_MENTIONS = 20;

const chatSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  uploadPaths: z.array(z.string()).optional(),
  artifactId: z.string().optional(),
  command: z
    .object({ name: z.string(), args: z.string().default("") })
    .optional(),
  mode: z
    .object({ name: z.enum(CHAT_MODES), args: z.string().default("") })
    .optional(),
  leftMode: z.enum(CHAT_MODES).optional(),
  mentions: z
    .array(
      z.object({
        kind: z.enum(MENTION_KINDS),
        key: z.string().min(1).max(200),
      }),
    )
    .max(MAX_MENTIONS)
    .optional(),
  // The conversation's own pick, in place of the caller's preference.
  model: z.string().min(1).max(200).optional(),
  effort: z.enum(AGENT_EFFORTS).optional(),
  // Honoured for an app admin only; from anyone else it changes nothing.
  debug: z.boolean().optional(),
});

const approveSchema = z.object({
  turnId: z.string(),
  id: z.string(),
  approve: z.boolean(),
  message: z.string().optional(),
  updatedInput: z.record(z.string(), z.any()).optional(),
});

/**
 * One run per chat turn. `session_cost_usd` keeps the running total the SDK
 * reports for a resumed session, from which the next turn's own cost is taken.
 */
async function recordChatTurn(
  result: Extract<AgentEvent, { type: "result" }>,
  turn: { turnId: string; userId: string | null; model: string },
) {
  const previousUsd = await lastSessionCostUsd(result.sessionId);
  await recordRun({
    mode: "chat",
    userId: turn.userId,
    model: turn.model,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    cacheReadTokens: result.usage?.cacheReadTokens,
    cacheWriteTokens: result.usage?.cacheWriteTokens,
    meta: {
      turn_id: turn.turnId,
      session_id: result.sessionId,
      session_cost_usd: result.costUsd,
      cost_usd: turnCostUsd(result.costUsd, previousUsd),
    },
  });
}

/** `turnId` is the turn already running, for the client to resume or stop. */
const turnInProgress = (c: Context, turnId: string | undefined) =>
  problem(c, 409, {
    problem: "turn-in-progress",
    detail: "you already have a chat turn running; stop it or wait for it",
    turnId,
  });

export const agent = new Hono()

  .get("/commands", async (c) => {
    const userEmail = getIdentity(c)?.email ?? env.userEmail;
    const user = userEmail ? await getUserByEmail(userEmail) : null;
    const ctx: ScopeContext = user
      ? {
          userId: user.id,
          teamId: (await userSoleTeamId(user.id)) ?? undefined,
        }
      : {};
    return c.json({
      uploadLimits: uploadLimits(),
      modes: CHAT_MODE_LIST.map(({ name, args, description }) => ({
        name,
        args,
        description,
      })),
      // Hidden ones are listed too, flagged, so a line a control writes into
      // the composer still goes out as its command.
      builtins: BUILTIN_COMMANDS.map(
        ({ name, args, description, subcommands, hidden }) => ({
          name,
          args,
          description,
          ...(hidden ? { hidden } : {}),
          ...(subcommands
            ? {
                subcommands: subcommands.map((s) => ({
                  name: s.name,
                  args: s.args,
                  description: s.description,
                  ...(s.client ? { client: true } : {}),
                })),
              }
            : {}),
        }),
      ),
      artifacts: await listVisibleArtifacts(ctx),
    });
  })

  .get("/mentions", async (c) => {
    const userEmail = getIdentity(c)?.email ?? env.userEmail;
    const user = userEmail ? await getUserByEmail(userEmail) : null;
    return c.json(await listMentionables(user?.id ?? null));
  })

  .post("/chat", validate("json", chatSchema), async (c) => {
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
    const {
      message,
      sessionId,
      uploadPaths,
      artifactId,
      command,
      mode,
      leftMode,
      mentions,
      model,
      effort,
      debug,
    } = c.req.valid("json");
    const debugging = debug === true && isAdminIdentity(c);
    const userEmail = getIdentity(c)?.email ?? env.userEmail;
    const userKey = userEmail ?? "anonymous";

    const running = activeByUser.get(userKey);
    if (running) return turnInProgress(c, running);

    const user = userEmail ? await getUserByEmail(userEmail) : null;
    const ctx: ScopeContext = user
      ? {
          userId: user.id,
          teamId: (await userSoleTeamId(user.id)) ?? undefined,
        }
      : {};
    const artifact = artifactId
      ? await getArtifact(artifactId, ctx)
      : undefined;
    if (mentions?.length) await checkMentions(user?.id ?? null, mentions);
    const prompt = buildPrompt({
      message,
      uploadPaths,
      artifact,
      command,
      mode,
      leftMode,
      mentions,
      dateFormat: user ? await dateFormatOf(ctx) : undefined,
    });

    const autoApprove = turnAutoApprove(command?.name, artifact?.spec);

    // Minted before the config so the MCP subprocess can carry it: a knowledge
    // edit made mid-turn records which conversation made it.
    const turnId = randomUUID();
    const settings = await effectiveSettings();
    const identity = getIdentity(c);
    const preferred = await mcpConfig(userEmail, settings, {
      id: turnId,
      actorRole:
        // The shared token and open mode are an app admin with no user row;
        // a minted token has an owner and is gated as them.
        !identity?.email && identity?.role === "admin" ? "admin" : undefined,
      origin: c.req.header("origin"),
    });
    const base = turnChoice(preferred, { model, effort });
    const requestId = requestIdOf(c);
    if (requestId) base.mcpEnv.TACHY_REQUEST_ID = requestId;
    const config: AgentConfig = {
      ...base,
      systemPrompt: await systemPrompt(),
      ...(autoApprove.length ? { autoApprove } : {}),
    };

    if (activeByUser.has(userKey))
      return turnInProgress(c, activeByUser.get(userKey));
    setAdmissionLimits({
      cap: settings.agent_slot_cap.value,
      queueMax: settings.agent_queue_max.value,
    });
    let ticket;
    try {
      ticket = admission.admit(1);
    } catch (err) {
      if (!(err instanceof QueueFull)) throw err;
      c.header("Retry-After", "30");
      return problem(c, 429, { detail: err.message });
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
      // pending is stopped rather than run unseen until the TTL.
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
          await send("stopped", { type: "stopped" });
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

        if (debugging)
          await send(
            "debug",
            turnDebug(prompt, config, { resumed: Boolean(sessionId) }),
          );
        turn = startTurn(
          prompt,
          config,
          sessionId ? { resume: sessionId } : {},
        );
        turns.set(turnId, {
          turn,
          email: userEmail,
          startedAt: Date.now(),
          leave,
        });
        for await (const event of turn.events()) {
          if (event.type === "result")
            await recordChatTurn(event, {
              turnId,
              userId: user?.id ?? null,
              model: event.models[0] ?? effectiveModel(config),
            }).catch(() => {});
          if (event.type === "session" && !debugging) continue;
          await send(event.type, event);
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
    validate("json", z.object({ turnId: z.string() })),
    async (c) => {
      const { turnId } = c.req.valid("json");
      const email = getIdentity(c)?.email ?? env.userEmail;
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

  .post("/approve", validate("json", approveSchema), async (c) => {
    const { turnId, id, approve, message, updatedInput } = c.req.valid("json");
    const entry = turns.get(turnId);
    if (!entry) throw notFound("unknown or finished turn");
    const email = getIdentity(c)?.email ?? env.userEmail;
    // Compared even when the turn resolved no email: skipping the check for an
    // unattributed turn would open it to anyone who guesses its id.
    if (entry.email !== email)
      throw forbidden("only the user who started this turn can approve it");
    entry.turn.approve(id, { approve, message, updatedInput });
    return c.json({ ok: true });
  })

  // The picture an image upload holds, for whoever uploaded it: what the
  // review box of a tool that keeps one shows. Fitted as it is for a model.
  .get("/uploads/:id", async (c) => {
    const owner = await requireCaller(c);
    const upload = await readUpload(uploadRef(c.req.param("id"), ""), owner);
    if (!isImageFile(upload))
      throw badInput("only an image upload has a preview");
    const image = await imageForModel(upload.bytes);
    return c.body(new Uint8Array(image.bytes), 200, {
      ...INERT_HEADERS,
      "Content-Type": image.mimeType,
      "Cache-Control": "private, max-age=3600",
    });
  })

  .post("/uploads", async (c) => {
    const owner = await requireCaller(c);
    // Checked before parseBody, which buffers the whole request first: past
    // that point the limit has already been paid for in memory.
    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > requestLimitBytes()) throw tooLarge(declared);
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw badInput("expected a 'file' field");
    if (file.size > requestLimitBytes()) throw tooLarge(file.size);
    const filename = basename(file.name || "upload");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = inspectFile(filename, bytes);
    if ("refusal" in check) return problem(c, 415, { detail: check.refusal });
    const family = fileFamily(check.contentType);
    const limitBytes = uploadLimitBytes(family, uploadLimits());
    if (file.size > limitBytes) throw tooLarge(file.size, limitBytes, family);
    const { ref } = await saveUpload({
      userId: owner,
      filename,
      contentType: check.contentType,
      bytes,
    });
    return c.json({ path: ref, filename: file.name });
  });
