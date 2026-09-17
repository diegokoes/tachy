import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, parseUploadRef } from "@tachy/core";
import { createApp } from "../packages/api/src/app";
import { loginCookie, resetData, sql } from "./helpers";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });

beforeEach(resetData);

describe("chat uploads", () => {
  it("stores an upload in the database for its uploader and hands back a reference", async () => {
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
    const ref = parseUploadRef(path)!;
    expect(ref.filename).toBe("notes.txt");
    const [row] =
      await sql`select user_id, byte_size, expires_at > now() + interval '23 hours' as long from chat_uploads where id = ${ref.id}`;
    expect(row).toMatchObject({ user_id: user.id, byte_size: 5, long: true });
  });
});
