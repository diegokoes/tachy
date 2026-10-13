import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSettingsCache, setSetting } from "@tachy/core/config";
import { createUser } from "@tachy/core/access";
import type { AgentConfig, AgentEvent, AgentTurn } from "@tachy/agent";
import { createApp } from "../../packages/api/src/app";
import { json, loginCookie } from "../http";
import { resetData, sql } from "../database";

class FakeTurn implements AgentTurn {
  finished = false;
  pendingApprovals = 0;
  oldestPendingApprovalAt = null;
  private push?: (event: AgentEvent | null) => void;
  private backlog: (AgentEvent | null)[] = [];

  emit(event: AgentEvent | null) {
    if (this.push) this.push(event);
    else this.backlog.push(event);
  }
  finish() {
    this.finished = true;
    this.emit(null);
  }
  approve() {}
  abort() {
    this.finish();
  }
  async *events(): AsyncGenerator<AgentEvent> {
    for (;;) {
      const event =
        this.backlog.shift() ??
        (await new Promise<AgentEvent | null>((resolve) => {
          this.push = (e) => {
            this.push = undefined;
            resolve(e);
          };
        }));
      if (event === null) return;
      yield event;
    }
  }
}

const started: FakeTurn[] = [];
/** What each started turn was configured with, in the order of `started`. */
const configs: AgentConfig[] = [];
vi.mock("@tachy/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tachy/agent")>()),
  startTurn: (_prompt: string, config: AgentConfig) => {
    const turn = new FakeTurn();
    started.push(turn);
    configs.push(config);
    return turn;
  },
}));

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });
const cookies: Record<string, string> = {};

async function chat(who: string, picked: Record<string, string> = {}) {
  const response = await app.request("/api/agent/chat", {
    ...json({ message: "hi", ...picked }),
    headers: { "Content-Type": "application/json", Cookie: cookies[who] },
  });
  return response;
}

/** Reads SSE frames until `until` matches one, and returns them all. */
async function framesUntil(
  response: Response,
  until: (event: string) => boolean,
): Promise<{ event: string; data: any }[]> {
  const reader = response.body!.getReader();
  const dec = new TextDecoder();
  const frames: { event: string; data: any }[] = [];
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      const event = /event: (.*)/.exec(raw)?.[1];
      const data = /data: (.*)/.exec(raw)?.[1];
      if (!event) continue;
      frames.push({ event, data: data ? JSON.parse(data) : null });
      if (until(event)) {
        reader.releaseLock();
        return frames;
      }
    }
  }
  return frames;
}

const post = (who: string, path: string, body: unknown) =>
  app.request(path, {
    ...json(body),
    headers: { "Content-Type": "application/json", Cookie: cookies[who] },
  });

const settle = () => new Promise((r) => setTimeout(r, 50));

beforeEach(async () => {
  await resetData();
  await sql`delete from settings where key = 'allowed_models'`;
  started.length = 0;
  configs.length = 0;
  for (const who of ["ana", "ben", "cai"]) {
    await createUser({
      email: `${who}@example.com`,
      password: "a-long-password",
      role: "member",
    });
    cookies[who] = await loginCookie(
      app,
      `${who}@example.com`,
      "a-long-password",
    );
  }
  await setSetting("agent_slot_cap", 1);
  await setSetting("agent_queue_max", 1);
  clearSettingsCache();
});

describe("chat admission", () => {
  it("allows one turn per user and lets them stop it", async () => {
    const first = await chat("ana");
    const [start] = await framesUntil(first, (e) => e === "start");
    await settle();
    expect(started).toHaveLength(1);

    const second = await chat("ana");
    expect(second.status).toBe(409);
    expect((await second.json()).turnId).toBe(start.data.turnId);

    expect(
      (await post("ben", "/api/agent/stop", { turnId: start.data.turnId }))
        .status,
    ).toBe(403);
    expect(
      (await post("ana", "/api/agent/stop", { turnId: start.data.turnId }))
        .status,
    ).toBe(200);
    await settle();
    expect((await chat("ana")).status).toBe(200);
    started.forEach((t) => t.finish());
    await settle();
  });

  it("queues past the cap, refuses past the queue, and admits in order", async () => {
    const ana = await chat("ana");
    await framesUntil(ana, (e) => e === "start");
    await settle();

    const ben = await chat("ben");
    const benFrames = await framesUntil(ben, (e) => e === "queued");
    expect(benFrames.at(-1)!.data).toEqual({ position: 1 });
    expect(started).toHaveLength(1);

    const cai = await chat("cai");
    expect(cai.status).toBe(429);

    started[0].finish();
    await settle();
    expect(started).toHaveLength(2);
    started[1].finish();
    await settle();
  });

  it("takes a queued turn out of the queue when it is stopped", async () => {
    const ana = await chat("ana");
    await framesUntil(ana, (e) => e === "start");
    await settle();
    const ben = await chat("ben");
    const frames = await framesUntil(ben, (e) => e === "queued");
    const turnId = frames[0].data.turnId;

    expect((await post("ben", "/api/agent/stop", { turnId })).status).toBe(200);
    const rest = await framesUntil(ben, (e) => e === "stopped");
    expect(rest.at(-1)!.data).toEqual({ type: "stopped" });

    started[0].finish();
    await settle();
    expect(started).toHaveLength(1);
  });
});

describe("a conversation's own model", () => {
  it("runs the turn on the model and effort the message names", async () => {
    const picked = await chat("ana", {
      model: "claude-opus-5-5",
      effort: "high",
    });
    await framesUntil(picked, (e) => e === "start");
    await settle();
    expect(configs[0]).toMatchObject({
      model: "claude-opus-5-5",
      effort: "high",
    });
    started[0].finish();
    await settle();

    const plain = await chat("ana");
    await framesUntil(plain, (e) => e === "start");
    await settle();
    expect(configs[1].model).not.toBe("claude-opus-5-5");
    started[1].finish();
    await settle();
  });

  it("refuses a model off the org's list, and an effort it does not know", async () => {
    await setSetting("allowed_models", ["claude-sonnet-5"]);
    clearSettingsCache();
    const offList = await chat("ana", { model: "claude-opus-5-5" });
    expect(offList.status).toBe(400);
    expect(started).toHaveLength(0);

    expect((await chat("ana", { effort: "heroic" })).status).toBe(400);

    const listed = await chat("ana", { model: "claude-sonnet-5" });
    await framesUntil(listed, (e) => e === "start");
    await settle();
    expect(configs[0].model).toBe("claude-sonnet-5");
    started[0].finish();
    await settle();
  });
});
