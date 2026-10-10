import { scrypt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { setSignedCookie } from "hono/cookie";
import { createApp } from "../../packages/api/src/app";
import { landingPath, sessionSecret } from "../../packages/api/src/auth";
import {
  hashPassword,
  verifyPassword,
  createUser,
  isWeakerHash,
  setUserDisabled,
  setUserPassword,
} from "@tachy/core/access";
import { AppError } from "@tachy/core/infra";
import { cookieOf, json } from "../http";
import { resetData, sql } from "../database";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong horse battery", hash)).toBe(false);
  });

  it("rejects malformed stored hashes and null", async () => {
    expect(await verifyPassword("whatever", null)).toBe(false);
    expect(await verifyPassword("whatever", "not-a-hash")).toBe(false);
  });

  it("enforces the minimum length", async () => {
    await expect(hashPassword("short")).rejects.toThrow(AppError);
  });

  it("produces distinct hashes for the same password (random salt)", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same password!"),
      hashPassword("same password!"),
    ]);
    expect(a).not.toEqual(b);
  });
});

describe("password login + role gating", () => {
  let adminCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    await resetData();
    await createUser({
      email: "root@example.com",
      password: "admin-password",
      role: "admin",
    });
    await createUser({
      email: "sam@example.com",
      password: "member-password",
      role: "member",
    });
  });

  it("rejects a wrong password with 401", async () => {
    const response = await app.request(
      "/auth/password/login",
      json({ email: "root@example.com", password: "not-the-password" }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects an unknown user with 401", async () => {
    const response = await app.request(
      "/auth/password/login",
      json({ email: "ghost@example.com", password: "whatever-pass" }),
    );
    expect(response.status).toBe(401);
  });

  it("blocks unauthenticated /api access once bootstrapped", async () => {
    const response = await app.request("/api/teams");
    expect(response.status).toBe(401);
  });

  it("logs in and grants /api access via the session cookie", async () => {
    const login = await app.request(
      "/auth/password/login",
      json({ email: "root@example.com", password: "admin-password" }),
    );
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({
      email: "root@example.com",
      role: "admin",
    });
    adminCookie = cookieOf(login);
    expect(adminCookie).toContain("tachy_session=");

    const teams = await app.request("/api/teams", {
      headers: { cookie: adminCookie },
    });
    expect(teams.status).toBe(200);

    const me = await app.request("/auth/me", {
      headers: { cookie: adminCookie },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      email: "root@example.com",
      role: "admin",
      via: "password",
    });
  });

  it("members read but cannot mutate admin resources", async () => {
    const login = await app.request(
      "/auth/password/login",
      json({ email: "sam@example.com", password: "member-password" }),
    );
    expect(login.status).toBe(200);
    memberCookie = cookieOf(login);

    const read = await app.request("/api/teams", {
      headers: { cookie: memberCookie },
    });
    expect(read.status).toBe(200);

    const write = await app.request("/api/teams", {
      ...json({ slug: "sneaky", name: "Sneaky" }),
      headers: { "Content-Type": "application/json", cookie: memberCookie },
    });
    expect(write.status).toBe(403);

    const createUserRes = await app.request("/api/users", {
      ...json({ email: "sneaky@example.com" }),
      headers: { "Content-Type": "application/json", cookie: memberCookie },
    });
    expect(createUserRes.status).toBe(403);
  });

  it("shows a member the directory without how each account signs in", async () => {
    const forMember = await app.request("/api/users", {
      headers: { cookie: memberCookie },
    });
    expect(forMember.status).toBe(200);
    const [seenByMember] = await forMember.json();
    expect(seenByMember.email).toBeDefined();
    expect(seenByMember).not.toHaveProperty("has_password");
    expect(seenByMember).not.toHaveProperty("service_account");
    expect(seenByMember).not.toHaveProperty("password_login_allowed");

    const forAdmin = await app.request("/api/users", {
      headers: { cookie: adminCookie },
    });
    const [seenByAdmin] = await forAdmin.json();
    expect(seenByAdmin).toHaveProperty("has_password");

    for (const path of ["/api/users/memberships", "/api/users/team-members/x"])
      expect(
        (await app.request(path, { headers: { cookie: memberCookie } })).status,
      ).not.toBe(403);
  });

  it("admins can mutate", async () => {
    const write = await app.request("/api/teams", {
      ...json({ slug: "ops", name: "Ops" }),
      headers: { "Content-Type": "application/json", cookie: adminCookie },
    });
    expect(write.status).toBe(200);
  });

  it("a disabled user can no longer log in or use an old session", async () => {
    const [{ id }] =
      await sql`select id from users where email = 'sam@example.com'`;
    await setUserDisabled(id as string, true);

    const login = await app.request(
      "/auth/password/login",
      json({ email: "sam@example.com", password: "member-password" }),
    );
    expect(login.status).toBe(401);

    const viaOldCookie = await app.request("/api/teams", {
      headers: { cookie: memberCookie },
    });
    expect(viaOldCookie.status).toBe(401);
  });

  it("bearer token keeps full (admin) access", async () => {
    const tokenApp = createApp({
      passwordAuth: true,
      apiToken: "secret-token",
    });
    const response = await tokenApp.request("/api/users", {
      headers: { Authorization: "Bearer secret-token" },
    });
    expect(response.status).toBe(200);
  });
});

describe("login throttle", () => {
  const attempt = (address: string, email: string, password: string) =>
    app.request("/auth/password/login", {
      ...json({ email, password }),
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": address,
      },
    });

  beforeAll(async () => {
    process.env.TACHY_BEHIND_PROXY = "true";
    await resetData();
    await createUser({ email: "kim@example.com", password: "kim-password" });
  });
  afterAll(() => {
    delete process.env.TACHY_BEHIND_PROXY;
  });

  it("stops an address guessing at one account, and nobody else", async () => {
    for (let i = 0; i < 5; i++)
      expect(
        (await attempt("10.1.0.1", "kim@example.com", "guess-number-x")).status,
      ).toBe(401);
    const refused = await attempt(
      "10.1.0.1",
      "KIM@example.com",
      "kim-password",
    );
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("60");

    expect(
      (await attempt("10.1.0.2", "kim@example.com", "kim-password")).status,
    ).toBe(200);
  });

  it("stops an address trying one password across many accounts", async () => {
    for (let i = 0; i < 20; i++)
      expect(
        (await attempt("10.1.0.3", `user${i}@example.com`, "Winter2026!!"))
          .status,
      ).toBe(401);
    expect(
      (await attempt("10.1.0.3", "kim@example.com", "kim-password")).status,
    ).toBe(429);
  });

  it("ignores a forwarded address when no proxy vouches for it", async () => {
    delete process.env.TACHY_BEHIND_PROXY;
    for (let i = 0; i < 5; i++)
      await attempt(`10.2.0.${i}`, "lee@example.com", "guess-number-x");
    expect(
      (await attempt("10.2.0.99", "lee@example.com", "guess-number-x")).status,
    ).toBe(429);
    process.env.TACHY_BEHIND_PROXY = "true";
  });
});

describe("sessions", () => {
  const login = async (email: string, password: string) =>
    cookieOf(
      await app.request("/auth/password/login", json({ email, password })),
    );
  const me = (cookie: string) =>
    app.request("/api/me/preferences", { headers: { cookie } });

  beforeAll(async () => {
    await resetData();
    await createUser({
      email: "root@example.com",
      password: "admin-password",
      role: "admin",
    });
  });

  it("ends every open session on logout, so a copied cookie stops working", async () => {
    const laptop = await login("root@example.com", "admin-password");
    const phone = await login("root@example.com", "admin-password");
    expect((await me(phone)).status).toBe(200);

    const out = await app.request("/auth/logout", {
      method: "POST",
      headers: { cookie: laptop },
    });
    expect(out.status).toBe(200);
    expect((await me(laptop)).status).toBe(401);
    expect((await me(phone)).status).toBe(401);
    expect((await app.request("/auth/logout")).status).toBe(404);
  });

  it("ends sessions when the password changes", async () => {
    const before = await login("root@example.com", "admin-password");
    const [{ id }] =
      await sql`select id from users where email = 'root@example.com'`;
    await setUserPassword(id as string, "a-newer-password");
    expect((await me(before)).status).toBe(401);
    expect(
      (await me(await login("root@example.com", "a-newer-password"))).status,
    ).toBe(200);
  });

  it("refuses a cookie in the format issued before sessions had an epoch", async () => {
    const issue = (value: string) =>
      new Hono()
        .get("/", async (c) => {
          await setSignedCookie(c, "tachy_session", value, sessionSecret);
          return c.body(null);
        })
        .request("/");
    const expiry = Date.now() + 60_000;

    const former = cookieOf(await issue(`${expiry}|root@example.com`));
    expect((await me(former)).status).toBe(401);
    const staleEpoch = cookieOf(await issue(`${expiry}|0|root@example.com`));
    expect((await me(staleEpoch)).status).toBe(401);
    const expired = cookieOf(await issue(`1|999|root@example.com`));
    expect((await me(expired)).status).toBe(401);
  });

  it("refuses a write a browser sends from another site, and allows its own", async () => {
    const cookie = await login("root@example.com", "a-newer-password");
    const write = (headers: Record<string, string>) =>
      app.request("/api/teams", {
        ...json({
          slug: `t${Object.values(headers).join("").length}`,
          name: "T",
        }),
        headers: { "Content-Type": "application/json", cookie, ...headers },
      });

    expect((await write({ "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    expect((await write({ "Sec-Fetch-Site": "same-site" })).status).toBe(403);
    expect(
      (await write({ Origin: "https://evil.example", Host: "tachy.local" }))
        .status,
    ).toBe(403);
    expect((await write({ Origin: "not a url" })).status).toBe(403);

    expect((await write({ "Sec-Fetch-Site": "same-origin" })).status).toBe(200);
    expect(
      (await write({ Origin: "https://tachy.local", Host: "tachy.local" }))
        .status,
    ).toBe(200);

    const read = await app.request("/api/teams", {
      headers: { cookie, "Sec-Fetch-Site": "cross-site" },
    });
    expect(read.status).toBe(200);

    const signOut = await app.request("/auth/logout", {
      method: "POST",
      headers: { cookie, "Sec-Fetch-Site": "cross-site" },
    });
    expect(signOut.status).toBe(403);
    expect((await me(cookie)).status).toBe(200);
  });

  it("rehashes a password stored at a lower cost the next time it is used", async () => {
    const weak =
      "scrypt$16384$8$1$c2FsdHNhbHRzYWx0c2FsdA==$" +
      (
        await new Promise<Buffer>((resolve, reject) =>
          scrypt(
            "an-older-password",
            Buffer.from("c2FsdHNhbHRzYWx0c2FsdA==", "base64"),
            64,
            { N: 16384, r: 8, p: 1 },
            (err, key) => (err ? reject(err) : resolve(key)),
          ),
        )
      ).toString("base64");
    expect(isWeakerHash(weak)).toBe(true);
    await sql`update users set password_hash = ${weak} where email = 'root@example.com'`;

    const cookie = await login("root@example.com", "an-older-password");
    expect((await me(cookie)).status).toBe(200);
    const [{ password_hash }] =
      await sql`select password_hash from users where email = 'root@example.com'`;
    expect(isWeakerHash(password_hash as string)).toBe(false);
    expect(
      await verifyPassword("an-older-password", password_hash as string),
    ).toBe(true);
  });
});

describe("where a sign-in lands", () => {
  it("keeps a path on this server, with its query and fragment", () => {
    expect(landingPath("/")).toBe("/");
    expect(landingPath("/library/wiki?product=lc#gaps")).toBe(
      "/library/wiki?product=lc#gaps",
    );
  });

  it("sends anything that leads to another site to the home page", () => {
    for (const target of [
      "https://example.com/",
      "//example.com/",
      "/\\example.com/",
      "/\t/example.com/",
      "\\\\example.com",
      "javascript:alert(1)",
      "http://",
    ])
      expect(landingPath(target), target).toBe("/");
  });

  it("goes home when no target is given", () => {
    expect(landingPath(undefined)).toBe("/");
    expect(landingPath("")).toBe("/");
  });
});
