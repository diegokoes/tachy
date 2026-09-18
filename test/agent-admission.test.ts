import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSettingsCache, createUser, setSetting } from "@tachy/core";
import type { AgentEvent, AgentTurn } from "@tachy/agent";
import { createApp } from "../packages/api/src/app";
import { json, loginCookie, resetData, sql } from "./helpers";

class FakeTurn implements AgentTurn {
  finished = false;
  pendingApprovals = 0;
  private push?: (ev: AgentEvent | null) => void;
  private backlog: (AgentEvent | null)[] = [];

  emit(ev: AgentEvent | null) {
    if (this.push) this.push(ev);
    else this.backlog.push(ev);
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
      const ev =
        this.backlog.shift() ??
        (await new Promise<AgentEvent | null>((r) => {
          this.push = (e) => {
            this.push = undefined;
            r(e);
          };
        }));
      if (ev === null) return;
      yield ev;
    }
  }
}

const started: FakeTurn[] = [];
vi.mock("@tachy/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tachy/agent")>()),
  startTurn: () => {
    const t = new FakeTurn();
    started.push(t);
    return t;
  },
}));

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });
const cookies: Record<string, string> = {};

async function chat(who: string) {
  const res = await app.request("/api/agent/chat", {
    ...json({ message: "hi" }),
    headers: { "Content-Type": "application/json", Cookie: cookies[who] },
  });
  return res;
}

/** Reads SSE frames until `until` matches one, and returns them all. */
async function framesUntil(
  res: Response,
  until: (event: string) => boolean,
): Promise<{ event: string; data: any }[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const out: { event: string; data: any }[] = [];
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /event: (.*)/.exec(raw)?.[1];
      const data = /data: (.*)/.exec(raw)?.[1];
      if (!event) continue;
      out.push({ event, data: data ? JSON.parse(data) : null });
      if (until(event)) {
        reader.releaseLock();
        return out;
      }
    }
  }
  return out;
}

const post = (who: string, path: string, body: unknown) =>
  app.request(path, {
    ...json(body),
    headers: { "Content-Type": "application/json", Cookie: cookies[who] },
  });

const settle = () => new Promise((r) => setTimeout(r, 50));

beforeEach(async () => {
  await resetData();
  started.length = 0;
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
    const rest = await framesUntil(ben, (e) => e === "error");
    expect(rest.at(-1)!.data.message).toBe("Stopped.");

    started[0].finish();
    await settle();
    expect(started).toHaveLength(1);
  });
});
