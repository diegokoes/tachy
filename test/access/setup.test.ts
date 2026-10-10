import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../packages/api/src/app";
import { isSetupCode, setupCode } from "../../packages/api/src/setup-code";
import {
  getSettings,
  clearSettingsCache,
  credentialSource,
  resolveCredential,
} from "@tachy/core/config";
import { enableVault } from "../vault";
import { json } from "../http";
import { resetData, sql } from "../database";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });

/** A setup request from someone who has read the server's log. */
const withCode = (body: Record<string, unknown>) =>
  json({ setup_code: setupCode(), ...body });

describe("first-run setup wizard", () => {
  beforeAll(resetData);

  it("reports un-bootstrapped on a fresh instance, /api stays open", async () => {
    const written = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const status = await app.request("/api/setup/status");
    await app.request("/api/setup/status");
    const announcements = written.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes('"event":"setup_code"'));
    written.mockRestore();

    expect(await status.json()).toEqual({ bootstrapped: false });
    // Once per process, however often the wizard asks.
    expect(announcements).toHaveLength(1);
    expect(announcements[0]).toContain(setupCode());

    const teams = await app.request("/api/teams");
    expect(teams.status).toBe(200);
  });

  it("refuses setup without the code from the server's log", async () => {
    const founder = {
      email: "stranger@example.com",
      password: "a-long-password",
    };
    for (const body of [
      founder,
      { ...founder, setup_code: "" },
      { ...founder, setup_code: "0".repeat(setupCode().length) },
    ]) {
      const response = await app.request("/api/setup", json(body));
      expect(response.status).toBe(403);
      expect((await response.json()).error).toMatch(/setup code/);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(await sql`select 1 from users`).toHaveLength(0);
  });

  it("asks for the code where a token or SSO already opened the port", async () => {
    const founder = {
      email: "stranger@example.com",
      password: "a-long-password",
    };
    const withToken = createApp({
      passwordAuth: true,
      apiToken: "install-token",
    });
    const withSso = createApp({
      passwordAuth: true,
      oidc: {
        issuer: "https://login.example.com",
        clientId: "tachy",
        clientSecret: "secret",
        sessionSecret: "s".repeat(40),
      },
    });
    for (const deployment of [withToken, withSso]) {
      const response = await deployment.request("/api/setup", json(founder));
      expect(response.status).toBe(403);
    }
    // The token opens the api, and still does not stand in for the code.
    const response = await withToken.request("/api/setup", {
      ...json(founder),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer install-token",
      },
    });
    expect(response.status).toBe(403);
    expect(await sql`select 1 from users`).toHaveLength(0);
  });

  it("takes the code as it is copied from a log line", () => {
    expect(isSetupCode(`  ${setupCode().toUpperCase()}\n`)).toBe(true);
    expect(isSetupCode(setupCode().slice(1))).toBe(false);
    expect(isSetupCode(undefined)).toBe(false);
  });

  it("refuses to take over an account that already exists", async () => {
    // An attribution user - what `TACHY_USER_EMAIL` creates on a sync or an MCP
    // call, before anyone has run the wizard. It has no password and no role,
    // and taking it over would hand back a session as its owner.
    await sql`insert into users (email) values ('colleague@example.com')`;

    const response = await app.request(
      "/api/setup",
      withCode({
        email: "colleague@example.com",
        password: "attacker-chosen-password",
      }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/already exists/);

    const [row] =
      await sql`select role, password_hash from users where email = 'colleague@example.com'`;
    expect(row.role).toBe("member");
    expect(row.password_hash).toBeNull();

    await sql`delete from users where email = 'colleague@example.com'`;
  });

  it("bootstraps admin + settings + workspace in one POST", async () => {
    const response = await app.request(
      "/api/setup",
      withCode({
        email: "founder@example.com",
        password: "a-long-password",
        display_name: "Founder",
        org_name: "osapiens",
        team: { slug: "hw", name: "Hardware" },
        product: { slug: "lc", name: "Line Controller" },
        products: [
          { slug: "mas", name: "MAS" },
          { slug: "printer", name: "Printer" },
        ],
        settings: {
          redaction_global: true,
          agent_effort: "high",
          deployment_profile: "engineering",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("tachy_session=");

    const status = await app.request("/api/setup/status");
    expect(await status.json()).toEqual({ bootstrapped: true });

    const [admin] =
      await sql`select role, password_hash from users where email = 'founder@example.com'`;
    expect(admin.role).toBe("admin");
    expect(admin.password_hash).toMatch(/^scrypt\$/);

    clearSettingsCache();
    expect(await getSettings()).toMatchObject({
      org_name: "osapiens",
      redaction_global: true,
      agent_effort: "high",
      deployment_profile: "engineering",
    });

    const [team] = await sql`select id from teams where slug = 'hw'`;
    expect(team).toBeTruthy();
    const products = await sql`
      select p.slug from products p join teams t on t.id = p.team_id
      where t.slug = 'hw' order by p.slug
    `;
    expect(products.map((p) => p.slug)).toEqual(["lc", "mas", "printer"]);

    const config = await (await app.request("/auth/config")).json();
    expect(config.profile).toBe("engineering");
    expect(config.envBadge).toBeNull();
  });

  it("locks /api against anonymous requests after bootstrap", async () => {
    const response = await app.request("/api/teams");
    expect(response.status).toBe(401);
  });

  it("refuses a second bootstrap", async () => {
    const response = await app.request(
      "/api/setup",
      json({
        email: "intruder@example.com",
        password: "another-long-pass",
      }),
    );
    expect(response.status).toBe(409);
  });

  it("rejects a too-short password", async () => {
    const response = await app.request(
      "/api/setup",
      json({ email: "x@example.com", password: "short" }),
    );
    expect(response.status).toBe(400);
  });
});

describe("first-run setup with an agent key", () => {
  beforeAll(async () => {
    await resetData();
    await sql`truncate credentials cascade`;
    enableVault();
  });

  it("stores the agent key encrypted, as the first admin's own", async () => {
    const response = await app.request(
      "/api/setup",
      withCode({
        email: "keyed@example.com",
        password: "a-long-password",
        settings: { agent_effort: "high" },
        agent_key: "sk-ant-from-wizard",
      }),
    );
    expect(response.status).toBe(200);

    const [admin] = await sql<{ id: string }[]>`
      select id from users where email = 'keyed@example.com'
    `;
    const ctx = { userId: admin.id };
    expect(await credentialSource("anthropic_api_key", ctx)).toBe("user");
    expect(await resolveCredential("anthropic_api_key", ctx)).toBe(
      "sk-ant-from-wizard",
    );

    // Nobody else inherits it.
    expect(await credentialSource("anthropic_api_key", {})).toBeUndefined();

    const [row] = await sql`select value_ciphertext from credentials`;
    expect(row.value_ciphertext.toString("utf8")).not.toContain("sk-ant");
  });
});
