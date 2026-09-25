import { randomUUID } from "node:crypto";
import { basename } from "node:path";
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
  effectiveSettings,
  getUserByEmail,
  userSoleTeamId,
  getArtifact,
  listVisibleArtifacts,
  type ScopeContext,
  saveUpload,
  unavailable,
} from "@tachy/core";
import { startTurn, type AgentConfig, type AgentTurn } from "@tachy/agent";
import { requireCaller } from "../authz";
import { sessionEmail } from "../auth";
import { lifecycle } from "../lifecycle";
import { requestIdOf } from "../logging";
import { AdmissionCancelled, QueueFull } from "../admission";
import { BUILTIN_COMMANDS } from "../commands";
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
} from "../turn-config";

const ABANDONED_MS = 30_000;
const KEEPALIVE_MS = 20_000;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

const tooLarge = (bytes: number) =>
  badInput(
    `file is ${megabytes(bytes)} MB, over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB upload limit`,
  );

const chatSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  uploadPaths: z.array(z.string()).optional(),
  artifactId: z.string().optional(),
  command: z
    .object({ name: z.string(), args: z.string().default("") })
    .optional(),
});

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
      systemPrompt: await systemPrompt(),
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
    setAdmissionLimits({
      cap: settings.agent_slot_cap.value,
      queueMax: settings.agent_queue_max.value,
    });
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
    if (declared > MAX_UPLOAD_BYTES) throw tooLarge(declared);
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw badInput("expected a 'file' field");
    if (file.size > MAX_UPLOAD_BYTES) throw tooLarge(file.size);
    const filename = basename(file.name || "upload");
    const { ref } = await saveUpload({
      userId: owner,
      filename,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return c.json({ path: ref, filename: file.name });
  });
