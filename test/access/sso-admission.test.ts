import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuth } from "@hono/oidc-auth";
import { Hono } from "hono";
import { createUser, setUserDisabled } from "@tachy/core/access";
import { clearSettingsCache, setSetting } from "@tachy/core/config";
import { NOT_INVITED } from "@tachy/core";
import { createApp } from "../../packages/api/src/app";
import { sessionEmail } from "../../packages/api/src/auth";
import { uninvitedFrom } from "../../packages/web/src/access/uninvited";
import { loginCookie } from "../http";
import { resetData, sql } from "../database";

// The provider's half of a sign-in. Everything after it, which is what decides
// who gets in, is the app's own.
vi.mock("@hono/oidc-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hono/oidc-auth")>()),
  getAuth: vi.fn(),
}));

afterAll(() => sql.end());

const app = createApp({
  passwordAuth: true,
  oidc: {
    issuer: "https://login.example.com",
    clientId: "tachy",
    clientSecret: "secret",
    sessionSecret: "s".repeat(40),
  },
});

const signedInAs = (email: string | null, name?: string) =>
  vi
    .mocked(getAuth)
    .mockResolvedValue((email ? { email, name } : null) as never);

const usersNamed = (email: string) =>
  sql`select role, display_name from users where email = ${email}`;

beforeEach(async () => {
  await resetData();
  clearSettingsCache();
  // The break-glass admin: under SSO a password works for flagged accounts only.
  await createUser({
    email: "root@example.com",
    password: "a-long-password",
    role: "admin",
    passwordLoginAllowed: true,
  });
});

describe("who an SSO sign-in lets in", () => {
  it("turns away someone nobody added, and makes no account for them", async () => {
    signedInAs("stranger@example.com", "A Stranger");

    const me = await app.request("/auth/me");
    expect(me.status).toBe(403);
    expect(await me.json()).toMatchObject({
      code: NOT_INVITED,
      email: "stranger@example.com",
    });
    expect((await app.request("/api/teams")).status).toBe(403);
    expect(await usersNamed("stranger@example.com")).toHaveLength(0);
  });

  it("lets in an account an admin added, with the name the provider gives", async () => {
    await createUser({ email: "sam@example.com" });
    signedInAs("sam@example.com", "Sam Example");

    const me = await app.request("/auth/me");
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      email: "sam@example.com",
      role: "member",
      via: "sso",
    });
    expect((await app.request("/api/teams")).status).toBe(200);
    expect((await usersNamed("sam@example.com"))[0].display_name).toBe(
      "Sam Example",
    );
  });

  it("still refuses a disabled account as signed out, not as uninvited", async () => {
    const gone = await createUser({ email: "gone@example.com" });
    await setUserDisabled(gone.id, true);
    signedInAs("gone@example.com");
    expect((await app.request("/auth/me")).status).toBe(401);
  });

  it("asks nothing of a request the provider has not signed in", async () => {
    signedInAs(null);
    expect((await app.request("/auth/me")).status).toBe(401);
    expect((await app.request("/api/teams")).status).toBe(401);
  });

  it("provisions on first sign-in once the setting says anyone", async () => {
    await setSetting("sso_admission", "anyone");
    signedInAs("newcomer@example.com", "New Comer");

    const me = await app.request("/auth/me");
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ role: "member", via: "sso" });
    expect(await usersNamed("newcomer@example.com")).toMatchObject([
      { role: "member", display_name: "New Comer" },
    ]);
  });

  it("leaves the setup status open to someone not yet let in", async () => {
    await sql`delete from users`;
    signedInAs("founder@example.com");
    const status = await app.request("/api/setup/status");
    expect(await status.json()).toEqual({ bootstrapped: false });
  });
});

describe("who setup takes the caller to be", () => {
  const who = new Hono().get("/who", async (c) =>
    c.json({ email: (await sessionEmail(c)) ?? null }),
  );
  const ask = async (cookie?: string) =>
    (
      await (
        await who.request("/who", cookie ? { headers: { cookie } } : {})
      ).json()
    ).email as string | null;

  it("is the provider's account when no password session is open", async () => {
    signedInAs("founder@example.com");
    expect(await ask()).toBe("founder@example.com");
  });

  it("is the password session's account ahead of the provider's", async () => {
    signedInAs("founder@example.com");
    const cookie = await loginCookie(
      app,
      "root@example.com",
      "a-long-password",
    );
    expect(cookie).not.toBe("");
    expect(await ask(cookie)).toBe("root@example.com");
  });

  it("is nobody when the provider has no session, or cannot say", async () => {
    signedInAs(null);
    expect(await ask()).toBeNull();
    vi.mocked(getAuth).mockRejectedValue(new Error("no session cookie"));
    expect(await ask()).toBeNull();
  });
});

describe("how the app reads that refusal", () => {
  it("knows it by its code, and nothing else as it", () => {
    expect(
      uninvitedFrom(403, { code: NOT_INVITED, email: "stranger@example.com" }),
    ).toEqual({ email: "stranger@example.com" });
    expect(uninvitedFrom(403, { code: NOT_INVITED })).toEqual({ email: null });
    expect(uninvitedFrom(403, { error: "forbidden" })).toBeNull();
    expect(uninvitedFrom(401, { code: NOT_INVITED })).toBeNull();
    expect(uninvitedFrom(200, { email: "sam@example.com" })).toBeNull();
    expect(uninvitedFrom(500, null)).toBeNull();
  });
});
