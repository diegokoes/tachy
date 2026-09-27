import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, recordToolCall, recordView } from "@tachy/core";
import { createApp } from "../packages/api/src/app";
import { json, resetData, sql } from "./helpers";

afterAll(() => sql.end());

beforeEach(resetData);

describe("service accounts", () => {
  it("leaves their reads and tool calls out of engagement", async () => {
    const person = await createUser({ email: "person@example.com" });
    const robot = await createUser({
      email: "load-turn-01@tachy.local",
      serviceAccount: true,
    });
    const [entry] = await sql`
      insert into knowledge_entries (status, issue_summary)
      values ('approved', 'printer queue stalls') returning id
    `;
    for (const u of [person, robot]) {
      await recordView({ entryId: entry.id }, u.id);
      await recordToolCall("search_knowledge", false, u.id, {
        ok: true,
        misuse: false,
      });
    }
    const views = await sql`select user_id from library_views`;
    const calls = await sql`select user_id from mcp_tool_calls`;
    expect(views.map((r) => r.user_id)).toEqual([person.id]);
    expect(calls.map((r) => r.user_id)).toEqual([person.id]);

    await recordToolCall("search_knowledge", false, null, {
      ok: true,
      misuse: false,
    });
    expect(
      await sql`select 1 from mcp_tool_calls where user_id is null`,
    ).toHaveLength(1);
  });
});

describe("password login under SSO", () => {
  const sso = createApp({
    passwordAuth: true,
    oidc: {
      issuer: "https://login.example.com",
      clientId: "tachy",
      clientSecret: "secret",
      sessionSecret: "s".repeat(40),
    },
  });
  const login = (email: string) =>
    sso.request(
      "/auth/password/login",
      json({ email, password: "a-long-password" }),
    );

  it("is refused unless the account is flagged for it", async () => {
    await createUser({
      email: "sso-user@example.com",
      password: "a-long-password",
    });
    await createUser({
      email: "break-glass@example.com",
      password: "a-long-password",
      role: "admin",
      passwordLoginAllowed: true,
    });
    expect((await login("sso-user@example.com")).status).toBe(403);
    expect((await login("break-glass@example.com")).status).toBe(200);
  });

  it("still works for everyone when SSO is not configured", async () => {
    await createUser({
      email: "plain@example.com",
      password: "a-long-password",
    });
    const app = createApp({ passwordAuth: true });
    const res = await app.request(
      "/auth/password/login",
      json({ email: "plain@example.com", password: "a-long-password" }),
    );
    expect(res.status).toBe(200);
  });
});
