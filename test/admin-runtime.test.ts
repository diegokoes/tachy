import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@tachy/core";
import { createApp } from "../packages/api/src/app";
import { loginCookie, resetData, sql } from "./helpers";

afterAll(() => {
  delete process.env.TACHY_STATUS_DIR;
  return sql.end();
});

const app = createApp({ passwordAuth: true });

async function cookieFor(email: string, role: "admin" | "member") {
  await createUser({ email, password: "a-long-password", role });
  return loginCookie(app, email, "a-long-password");
}

beforeEach(resetData);

describe("Admin > System runtime", () => {
  it("shows admins the current turns, connections and host status files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tachy-status-"));
    process.env.TACHY_STATUS_DIR = dir;
    await writeFile(
      join(dir, "backup.json"),
      JSON.stringify({ ok: true, at: "2026-09-17T06:00:00Z" }),
    );
    await writeFile(join(dir, "broken.json"), "{not json");

    const res = await app.request("/api/system", {
      headers: { Cookie: await cookieFor("ops@example.com", "admin") },
    });
    const { runtime } = await res.json();
    expect(runtime.draining).toBe(false);
    expect(runtime.turns).toMatchObject({
      slotsUsed: 0,
      queued: 0,
      running: {},
      pendingApprovals: 0,
      oldestApprovalAgeSeconds: null,
    });
    expect(runtime.postgres.max).toBeGreaterThan(0);
    expect(runtime.postgres.byProcess.length).toBeGreaterThan(0);
    expect(runtime.status).toEqual({
      backup: { ok: true, at: "2026-09-17T06:00:00Z" },
      broken: { error: "unreadable" },
    });
    expect(typeof runtime.eventLoopP99Ms).toBe("number");
  });

  it("keeps the runtime block from members", async () => {
    const res = await app.request("/api/system", {
      headers: { Cookie: await cookieFor("dev@example.com", "member") },
    });
    const body = await res.json();
    expect(body.runtime).toBeUndefined();
    expect(body.settings).toBeDefined();
  });

  it("pauses new chats for maintenance while everything else stays ready", async () => {
    const cookie = await cookieFor("ops2@example.com", "admin");
    const post = (body: unknown) =>
      app.request("/api/system/maintenance", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", Cookie: cookie },
      });
    try {
      expect((await post({ refuse_chats: true })).status).toBe(200);
      const chat = await app.request("/api/agent/chat", {
        method: "POST",
        body: JSON.stringify({ message: "hi" }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
      });
      expect(chat.status).toBe(503);
      expect(chat.headers.get("Retry-After")).toBe("300");
      expect((await app.request("/readyz")).status).toBe(200);

      const { runtime } = await (
        await app.request("/api/system", { headers: { Cookie: cookie } })
      ).json();
      expect(runtime.refusingChats).toBe(true);
      expect(runtime.readiness.ready).toBe(true);
      expect(runtime.security).toMatchObject({
        sso_configured: false,
        users_with_password: 1,
      });
      expect(runtime.tableSizes.length).toBeGreaterThan(0);
    } finally {
      await post({ refuse_chats: false });
    }
  });
});
