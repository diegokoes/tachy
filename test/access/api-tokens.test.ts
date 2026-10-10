import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createUser,
  listApiTokens,
  mintApiToken,
  setUserDisabled,
  tokenExpiry,
  userByApiToken,
} from "@tachy/core/access";
import {
  API_TOKEN_PREFIX,
  DEFAULT_TOKEN_DAYS,
  TOKEN_LIFETIME_DAYS,
} from "@tachy/core";
import { listAudit } from "@tachy/core/audit";
import { AppError } from "@tachy/core/infra";
import { createApp } from "../../packages/api/src/app";
import { toolsDatabaseUrl } from "../../packages/api/src/turn-config";
import { lifetimeDaysOf, mintTokenFor } from "../../packages/cli/src/tokens";
import {
  DEFAULT_LIFETIME,
  LIFETIME_OPTIONS,
  NEVER,
  expiryNote,
  lifetimeDays,
  tokenState,
} from "../../packages/web/src/settings/tokens";
import { json, loginCookie } from "../http";
import { resetData, sql } from "../database";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true, apiToken: "the-shared-token" });

async function people() {
  const admin = await createUser({
    email: "root@example.com",
    password: "admin-password",
    role: "admin",
  });
  const member = await createUser({
    email: "sam@example.com",
    password: "member-password",
  });
  return {
    admin,
    member,
    adminCookie: await loginCookie(app, "root@example.com", "admin-password"),
    memberCookie: await loginCookie(app, "sam@example.com", "member-password"),
  };
}

const withBearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const post = (path: string, headers: Record<string, string>, body: unknown) =>
  app.request(path, {
    ...json(body),
    headers: { "Content-Type": "application/json", ...headers },
  });

beforeEach(resetData);

describe("api tokens in core", () => {
  it("resolves a token to its owner and stamps the use", async () => {
    const { member } = await people();
    const { token, row } = await mintApiToken({
      userId: member.id,
      name: "export script",
    });
    expect(token.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(row.hint).toBe(token.slice(-4));
    expect(row.last_used_at).toBeNull();

    expect(await userByApiToken(token)).toMatchObject({
      email: "sam@example.com",
      role: "member",
    });
    expect((await listApiTokens(member.id))[0].last_used_at).not.toBeNull();
    const stored = await sql`select token_hash from api_tokens`;
    expect(Buffer.from(stored[0].token_hash).toString()).not.toContain(token);
  });

  it("stops resolving once expired, revoked, or its owner is disabled", async () => {
    const { member } = await people();
    const mint = () => mintApiToken({ userId: member.id, name: "t" });

    expect(await userByApiToken("tachy_pat_made-up")).toBeNull();
    expect(await userByApiToken("another-kind-of-token")).toBeNull();
    await expect(
      mintApiToken({
        userId: member.id,
        name: "t",
        expiresAt: new Date(Date.now() - 1),
      }),
    ).rejects.toThrow(AppError);

    const expiring = await mint();
    await sql`update api_tokens set expires_at = now() - interval '1 second' where id = ${expiring.row.id}`;
    expect(await userByApiToken(expiring.token)).toBeNull();

    const kept = await mint();
    await setUserDisabled(member.id, true);
    expect(await userByApiToken(kept.token)).toBeNull();
  });
});

describe("api tokens over HTTP", () => {
  it("acts as its owner, with the owner's rights and name", async () => {
    const { memberCookie } = await people();
    const minted = await post(
      "/api/me/tokens",
      { cookie: memberCookie },
      { name: "export script", expires_in_days: 30 },
    );
    expect(minted.status).toBe(201);
    const { token, expires_at } = await minted.json();
    expect(Date.parse(expires_at)).toBeGreaterThan(Date.now());

    const read = await app.request("/api/teams", {
      headers: withBearer(token),
    });
    expect(read.status).toBe(200);
    const write = await post("/api/teams", withBearer(token), {
      slug: "sneaky",
      name: "Sneaky",
    });
    expect(write.status).toBe(403);

    const listed = await app.request("/api/me/tokens", {
      headers: withBearer(token),
    });
    const [row] = await listed.json();
    expect(row).toMatchObject({ name: "export script", revoked_at: null });
    expect(row).not.toHaveProperty("token");
    expect(row).not.toHaveProperty("token_hash");
  });

  it("refuses a bearer that looks minted and is not, whatever else is sent", async () => {
    const { adminCookie } = await people();
    const response = await app.request("/api/teams", {
      headers: { ...withBearer("tachy_pat_made-up"), cookie: adminCookie },
    });
    expect(response.status).toBe(401);
  });

  it("does not let a token mint another, its own or the shared one", async () => {
    const { adminCookie, admin } = await people();
    const { token } = await (
      await post("/api/me/tokens", { cookie: adminCookie }, { name: "ci" })
    ).json();

    for (const bearer of [token, "the-shared-token"]) {
      const mine = await post("/api/me/tokens", withBearer(bearer), {
        name: "again",
      });
      expect(mine.status).toBe(403);
      const theirs = await post(
        `/api/users/${admin.id}/tokens`,
        withBearer(bearer),
        { name: "again" },
      );
      expect(theirs.status).toBe(403);
    }
  });

  it("stops working when its owner revokes it, and records both ends", async () => {
    const { memberCookie } = await people();
    const { id, token } = await (
      await post("/api/me/tokens", { cookie: memberCookie }, { name: "ci" })
    ).json();

    const revoked = await app.request(`/api/me/tokens/${id}`, {
      method: "DELETE",
      headers: { cookie: memberCookie },
    });
    expect((await revoked.json()).revoked_at).not.toBeNull();
    expect(
      (await app.request("/api/teams", { headers: withBearer(token) })).status,
    ).toBe(401);

    const again = await app.request(`/api/me/tokens/${id}`, {
      method: "DELETE",
      headers: { cookie: memberCookie },
    });
    expect(again.status).toBe(200);

    const trail = (await listAudit()).filter((e) =>
      e.action.startsWith("api_token"),
    );
    expect(trail.map((e) => [e.action, e.target, e.actor_email])).toEqual([
      ["api_token_revoke", "ci", "sam@example.com"],
      ["api_token_revoke", "ci", "sam@example.com"],
      ["api_token_mint", "ci", "sam@example.com"],
    ]);
    expect(JSON.stringify(trail)).not.toContain(token);
  });

  it("lets an app admin mint, list and revoke for a service account", async () => {
    const { adminCookie, memberCookie } = await people();
    const robot = await createUser({
      email: "robot@example.com",
      serviceAccount: true,
    });
    const base = `/api/users/${robot.id}/tokens`;

    expect(
      (await post(base, { cookie: memberCookie }, { name: "x" })).status,
    ).toBe(403);
    expect(
      (
        await post(
          "/api/users/00000000-0000-4000-8000-000000000000/tokens",
          { cookie: adminCookie },
          { name: "x" },
        )
      ).status,
    ).toBe(404);

    const minted = await post(base, { cookie: adminCookie }, { name: "sync" });
    const { id, token } = await minted.json();
    const me = await app.request("/api/me/tokens", {
      headers: withBearer(token),
    });
    expect(await me.json()).toHaveLength(1);

    const listed = await app.request(base, {
      headers: { cookie: adminCookie },
    });
    expect(await listed.json()).toHaveLength(1);

    const elsewhere = await app.request(`/api/me/tokens/${id}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(elsewhere.status).toBe(404);
    const revoked = await app.request(`${base}/${id}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(revoked.status).toBe(200);
    expect((await listAudit())[0]).toMatchObject({
      action: "api_token_revoke",
      detail: { for: "robot@example.com" },
    });
  });
});

describe("where the chat tools connect", () => {
  const server = "postgres://tachy_app:app-secret@postgres:5432/tachy";

  it("is the server's own connection until a password for tachy_mcp is set", () => {
    delete process.env.TACHY_MCP_DB_PASSWORD;
    expect(toolsDatabaseUrl(server)).toBe(server);
  });

  it("is the same database as tachy_mcp once it is", () => {
    process.env.TACHY_MCP_DB_PASSWORD = "tools/secret";
    try {
      const url = new URL(toolsDatabaseUrl(server));
      expect(url.username).toBe("tachy_mcp");
      expect(decodeURIComponent(url.password)).toBe("tools/secret");
      expect(url.host + url.pathname).toBe("postgres:5432/tachy");
      expect(url.toString()).not.toContain("app-secret");
    } finally {
      delete process.env.TACHY_MCP_DB_PASSWORD;
    }
  });
});

describe("a token's state in the list", () => {
  it("says revoked before expired, and active otherwise", () => {
    const now = Date.parse("2026-10-09T00:00:00Z");
    const past = "2026-10-01T00:00:00Z";
    const future = "2026-11-01T00:00:00Z";
    expect(tokenState({ revoked_at: null, expires_at: null }, now)).toBe(
      "active",
    );
    expect(tokenState({ revoked_at: null, expires_at: future }, now)).toBe(
      "active",
    );
    expect(tokenState({ revoked_at: null, expires_at: past }, now)).toBe(
      "expired",
    );
    expect(tokenState({ revoked_at: past, expires_at: past }, now)).toBe(
      "revoked",
    );
  });
});

describe("how long a token lasts", () => {
  const DAY_MS = 86_400_000;
  const daysFromNow = (iso: string) =>
    Math.round((Date.parse(iso) - Date.now()) / DAY_MS);

  it("is the default when the request names none, and forever only when asked", async () => {
    const { memberCookie } = await people();
    const mint = async (body: Record<string, unknown>) =>
      (await post("/api/me/tokens", { cookie: memberCookie }, body)).json();

    expect(daysFromNow((await mint({ name: "unsaid" })).expires_at)).toBe(
      DEFAULT_TOKEN_DAYS,
    );
    expect(
      daysFromNow(
        (await mint({ name: "a year", expires_in_days: 365 })).expires_at,
      ),
    ).toBe(365);
    expect(
      (await mint({ name: "forever", expires_in_days: null })).expires_at,
    ).toBeNull();
  });

  it("applies the same default when an admin mints for a service account", async () => {
    const { adminCookie } = await people();
    const robot = await createUser({
      email: "robot@example.com",
      serviceAccount: true,
    });
    const minted = await post(
      `/api/users/${robot.id}/tokens`,
      { cookie: adminCookie },
      { name: "sync" },
    );
    expect(daysFromNow((await minted.json()).expires_at)).toBe(
      DEFAULT_TOKEN_DAYS,
    );
  });

  it("counts the lifetime from the moment of minting", () => {
    const now = Date.parse("2026-10-10T00:00:00Z");
    expect(tokenExpiry(30, now)?.toISOString()).toBe(
      "2026-11-09T00:00:00.000Z",
    );
    expect(tokenExpiry(undefined, now)?.getTime()).toBe(
      now + DEFAULT_TOKEN_DAYS * DAY_MS,
    );
    expect(tokenExpiry(null, now)).toBeNull();
  });

  it("offers the form the contract's lifetimes, starting on the default", () => {
    expect(LIFETIME_OPTIONS.map((o) => o.value)).toEqual([
      ...TOKEN_LIFETIME_DAYS,
      NEVER,
    ]);
    expect(DEFAULT_LIFETIME).toBe(DEFAULT_TOKEN_DAYS);
    expect(TOKEN_LIFETIME_DAYS).toContain(DEFAULT_TOKEN_DAYS);
    expect(lifetimeDays(365)).toBe(365);
    expect(lifetimeDays(NEVER)).toBeNull();
  });

  it("says on a token's row when it ends", () => {
    const day = (iso: string) => iso.slice(0, 10);
    expect(expiryNote({ expires_at: "2027-01-08T00:00:00Z" }, day)).toBe(
      "expires 2027-01-08",
    );
    expect(expiryNote({ expires_at: null }, day)).toBe("never expires");
  });
});

describe("minting from the command line", () => {
  it("reads the lifetime from its flags", () => {
    expect(lifetimeDaysOf({})).toBe(DEFAULT_TOKEN_DAYS);
    expect(lifetimeDaysOf({ days: "365" })).toBe(365);
    expect(lifetimeDaysOf({ never: "true" })).toBeNull();
    for (const days of ["0", "-3", "1.5", "soon"])
      expect(() => lifetimeDaysOf({ days }), days).toThrow(/whole number/);
  });

  it("mints for a service account, as that account, and records it", async () => {
    const robot = await createUser({
      email: "watch@example.com",
      serviceAccount: true,
    });
    const { token, expiresAt } = await mintTokenFor(
      "watch@example.com",
      "tachy-watch",
      365,
    );
    expect(Date.parse(expiresAt!)).toBeGreaterThan(Date.now());
    expect(await userByApiToken(token)).toMatchObject({
      id: robot.id,
      role: "member",
    });
    expect((await listAudit())[0]).toMatchObject({
      action: "api_token_mint",
      target: "tachy-watch",
      actor_email: null,
      detail: { for: "watch@example.com", by: "cli" },
    });

    // What tachy-watch reads: the runtime block, without how the host is secured.
    const system = await app.request("/api/system", {
      headers: withBearer(token),
    });
    expect(system.status).toBe(200);
    const body = await system.json();
    expect(body.runtime.turns).toBeDefined();
    expect(body.runtime.security).toBeNull();
    expect(body.env).toBeUndefined();
  });

  it("refuses an account that does not exist or is disabled", async () => {
    await expect(mintTokenFor("nobody@example.com", "x", 30)).rejects.toThrow(
      /no account/,
    );
    const gone = await createUser({ email: "gone@example.com" });
    await setUserDisabled(gone.id, true);
    await expect(mintTokenFor("gone@example.com", "x", 30)).rejects.toThrow(
      /disabled/,
    );
    expect(await sql`select 1 from api_tokens`).toHaveLength(0);
  });
});
