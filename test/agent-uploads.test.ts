import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, uploadDir } from "@tachy/core";
import { createApp } from "../packages/api/src/app";
import { loginCookie, resetData, sql } from "./helpers";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });

beforeEach(async () => {
  await resetData();
  process.env.TACHY_UPLOAD_DIR = await mkdtemp(join(tmpdir(), "tachy-up-"));
});

describe("chat uploads", () => {
  it("stores an upload under the uploader's own directory", async () => {
    const user = await createUser({
      email: "uploader@example.com",
      password: "a-long-password",
      role: "member",
    });
    const cookie = await loginCookie(
      app,
      "uploader@example.com",
      "a-long-password",
    );
    const form = new FormData();
    form.append("file", new File(["hello"], "notes.txt"));
    const res = await app.request("/api/agent/uploads", {
      method: "POST",
      body: form,
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const { path } = await res.json();
    expect(path.startsWith(uploadDir(user.id) + "/")).toBe(true);
    expect(path.endsWith("-notes.txt")).toBe(true);
  });
});
