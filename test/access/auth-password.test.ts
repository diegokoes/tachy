import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../packages/api/src/app";
import {
  hashPassword,
  verifyPassword,
  createUser,
  setUserDisabled,
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

  it("throttles repeated failures per email", async () => {
    for (let i = 0; i < 5; i++) {
      await app.request(
        "/auth/password/login",
        json({ email: "brute@example.com", password: "guess-number-x" }),
      );
    }
    const response = await app.request(
      "/auth/password/login",
      json({ email: "brute@example.com", password: "guess-number-x" }),
    );
    expect(response.status).toBe(429);
  });
});
