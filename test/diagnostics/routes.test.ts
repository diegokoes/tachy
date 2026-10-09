import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@tachy/core/access";
import { createApp } from "../../packages/api/src/app";
import { json, loginCookie } from "../http";
import { resetData } from "../database";

const app = createApp({ passwordAuth: true });

beforeEach(resetData);

describe("load runs API", () => {
  it("lets a member read runs and refuses starting or stopping one", async () => {
    await createUser({
      email: "boss@example.com",
      password: "a-long-password",
      role: "admin",
    });
    await createUser({ email: "dev@example.com", password: "a-long-password" });
    const member = await loginCookie(app, "dev@example.com", "a-long-password");

    const read = await app.request("/api/tests/runs", {
      headers: { Cookie: member },
    });
    expect(read.status).toBe(200);
    expect((await read.json()).runs).toEqual([]);

    const started = await app.request("/api/tests/runs", {
      ...json({ script: "smoke", target: "production" }),
      headers: { "Content-Type": "application/json", Cookie: member },
    });
    expect(started.status).toBe(403);

    const stopped = await app.request(
      "/api/tests/runs/00000000-0000-4000-8000-000000000000/cancel",
      { method: "POST", headers: { Cookie: member } },
    );
    expect(stopped.status).toBe(403);
  });
});
