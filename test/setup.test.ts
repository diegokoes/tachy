import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../packages/api/src/app";
import { getSettings, clearSettingsCache } from "@tachy/core";
import { resetData, sql } from "./helpers";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });
const json = (body: unknown) => ({
  method: "POST",
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});

describe("first-run setup wizard", () => {
  beforeAll(resetData);

  it("reports un-bootstrapped on a fresh instance, /api stays open", async () => {
    const status = await app.request("/api/setup/status");
    expect(await status.json()).toEqual({ bootstrapped: false });

    // open fallback: nothing configured and no admin yet
    const teams = await app.request("/api/teams");
    expect(teams.status).toBe(200);
  });

  it("bootstraps admin + settings + workspace in one POST", async () => {
    const res = await app.request("/api/setup", json({
      email: "founder@example.com",
      password: "a-long-password",
      display_name: "Founder",
      org_name: "osapiens",
      team: { slug: "hw", name: "Hardware" },
      product: { slug: "lc", name: "Line Controller" },
      settings: { redaction_global: true, agent_effort: "high" },
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("tachy_session=");

    const status = await app.request("/api/setup/status");
    expect(await status.json()).toEqual({ bootstrapped: true });

    const [admin] = await sql`select role, password_hash from users where email = 'founder@example.com'`;
    expect(admin.role).toBe("admin");
    expect(admin.password_hash).toMatch(/^scrypt\$/);

    clearSettingsCache();
    expect(await getSettings()).toMatchObject({
      org_name: "osapiens",
      redaction_global: true,
      agent_effort: "high",
    });

    const [team] = await sql`select id from teams where slug = 'hw'`;
    expect(team).toBeTruthy();
    const [product] = await sql`select id from products where slug = 'lc'`;
    expect(product).toBeTruthy();
  });

  it("locks /api against anonymous requests after bootstrap", async () => {
    const res = await app.request("/api/teams");
    expect(res.status).toBe(401);
  });

  it("refuses a second bootstrap", async () => {
    const res = await app.request("/api/setup", json({
      email: "intruder@example.com",
      password: "another-long-pass",
    }));
    expect(res.status).toBe(409);
  });

  it("rejects a too-short password", async () => {
    const res = await app.request("/api/setup", json({ email: "x@example.com", password: "short" }));
    expect(res.status).toBe(400);
  });
});
