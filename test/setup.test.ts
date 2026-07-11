import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../packages/api/src/app";
import {
  getSettings,
  clearSettingsCache,
  credentialSource,
  resolveCredential,
} from "@tachy/core";
import { enableVault, json, resetData, sql } from "./helpers";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });

describe("first-run setup wizard", () => {
  beforeAll(resetData);

  it("reports un-bootstrapped on a fresh instance, /api stays open", async () => {
    const status = await app.request("/api/setup/status");
    expect(await status.json()).toEqual({ bootstrapped: false });

    const teams = await app.request("/api/teams");
    expect(teams.status).toBe(200);
  });

  it("bootstraps admin + settings + workspace in one POST", async () => {
    const res = await app.request(
      "/api/setup",
      json({
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
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("tachy_session=");

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

    const cfg = await (await app.request("/auth/config")).json();
    expect(cfg.profile).toBe("engineering");
  });

  it("locks /api against anonymous requests after bootstrap", async () => {
    const res = await app.request("/api/teams");
    expect(res.status).toBe(401);
  });

  it("refuses a second bootstrap", async () => {
    const res = await app.request(
      "/api/setup",
      json({
        email: "intruder@example.com",
        password: "another-long-pass",
      }),
    );
    expect(res.status).toBe(409);
  });

  it("rejects a too-short password", async () => {
    const res = await app.request(
      "/api/setup",
      json({ email: "x@example.com", password: "short" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("first-run setup with a shared agent key", () => {
  beforeAll(async () => {
    await resetData();
    await sql`truncate credentials cascade`;
    enableVault();
  });

  it("stores the agent key encrypted as the global credential", async () => {
    const res = await app.request(
      "/api/setup",
      json({
        email: "keyed@example.com",
        password: "a-long-password",
        settings: { agent_provider: "claude" },
        agent_key: "sk-ant-from-wizard",
      }),
    );
    expect(res.status).toBe(200);

    expect(await credentialSource("anthropic_api_key", {})).toBe("global");
    expect(await resolveCredential("anthropic_api_key", {})).toBe(
      "sk-ant-from-wizard",
    );
    const [row] = await sql`select value_ciphertext from credentials`;
    expect(row.value_ciphertext.toString("utf8")).not.toContain("sk-ant");
  });
});
