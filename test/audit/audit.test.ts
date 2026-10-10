import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createUser, setTeamMember } from "@tachy/core/access";
import { listAudit, recordAudit } from "@tachy/core/audit";
import { addTeam } from "@tachy/core/catalog";
import { createOutput } from "@tachy/core/exports";
import { rememberSecret } from "@tachy/core/infra";
import { createApp } from "../../packages/api/src/app";
import { setupCode } from "../../packages/api/src/setup-code";
import { server } from "../../packages/mcp/src/index";
import { detailText } from "../../packages/web/src/audit/rows";
import { cookieOf, json, loginCookie } from "../http";
import { resetData, sql } from "../database";
import { disableVault, enableVault } from "../vault";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });

async function seedPeople() {
  await createUser({
    email: "root@example.com",
    password: "admin-password",
    role: "admin",
  });
  await createUser({ email: "sam@example.com", password: "member-password" });
  return {
    admin: await loginCookie(app, "root@example.com", "admin-password"),
    member: await loginCookie(app, "sam@example.com", "member-password"),
  };
}

const actions = async () => (await listAudit()).map((e) => e.action);

beforeEach(resetData);

describe("the audit trail", () => {
  it("lists newest first, pages by id and filters by action", async () => {
    for (const target of ["a", "b", "c"])
      await recordAudit({
        actor: { actor: "api" },
        action: "setting_set",
        target,
      });
    await recordAudit({ actor: { actor: "api" }, action: "maintenance_set" });

    const first = await listAudit({ limit: 2 });
    expect(first.map((e) => e.target)).toEqual([null, "c"]);
    const next = await listAudit({ before: first[1].id, limit: 2 });
    expect(next.map((e) => e.target)).toEqual(["b", "a"]);
    expect(await listAudit({ action: "maintenance_set" })).toHaveLength(1);
    expect(await listAudit({ limit: 0 })).toHaveLength(1);
  });

  it("masks a known secret that reaches the detail", async () => {
    const secret = rememberSecret("sk-ant-api03-not-for-the-trail");
    await recordAudit({
      actor: { actor: "web" },
      action: "setting_set",
      detail: { value: `prefix ${secret}` },
    });
    const [event] = await listAudit();
    expect(JSON.stringify(event.detail)).not.toContain(secret);
  });

  it("still names the account after it is deleted", async () => {
    const user = await createUser({ email: "gone@example.com" });
    await recordAudit({
      actor: { userId: user.id, actor: "web" },
      action: "login",
    });
    await sql`delete from users where id = ${user.id}`;
    expect((await listAudit())[0].actor_email).toBe("gone@example.com");
  });
});

describe("what the API records", () => {
  it("records sign-ins, failures and sign-outs with who and from where", async () => {
    const { admin } = await seedPeople();
    await app.request(
      "/auth/password/login",
      json({ email: "root@example.com", password: "not-the-password" }),
    );
    await app.request(
      "/auth/password/login",
      json({ email: "ghost@example.com", password: "whatever-pass" }),
    );
    await app.request("/auth/logout", {
      method: "POST",
      headers: { cookie: admin },
    });

    const events = await listAudit();
    expect(events.map((e) => [e.action, e.target, e.actor_email])).toEqual([
      ["logout", "root@example.com", "root@example.com"],
      ["login_failed", "ghost@example.com", null],
      ["login_failed", "root@example.com", "root@example.com"],
      ["login", "sam@example.com", "sam@example.com"],
      ["login", "root@example.com", "root@example.com"],
    ]);
    expect(events[0].actor).toBe("web");
    expect(events[0].address).toBe("unknown");
  });

  it("records account changes without the password", async () => {
    const { admin } = await seedPeople();
    const as = (path: string, method: string, body: unknown) =>
      app.request(path, {
        ...json(body),
        method,
        headers: { "Content-Type": "application/json", cookie: admin },
      });
    await addTeam("support", "Support");

    const created = await (
      await as("/api/users", "POST", {
        email: "new@example.com",
        password: "a-first-password",
      })
    ).json();
    await as(`/api/users/${created.id}`, "PATCH", {
      role: "admin",
      password: "a-second-password",
    });
    await as("/api/users/team-members/support", "PUT", {
      email: "new@example.com",
      role: "admin",
    });

    const [roster, updated, made] = await listAudit({ limit: 3 });
    expect(made).toMatchObject({
      action: "user_create",
      target: "new@example.com",
      detail: { role: "member", with_password: true },
    });
    expect(updated).toMatchObject({
      action: "user_update",
      target: "new@example.com",
      detail: { role: "admin", password: "changed" },
    });
    expect(roster).toMatchObject({
      action: "team_member_set",
      target: "new@example.com",
      detail: { team: "support", role: "admin" },
    });
    expect(JSON.stringify(await listAudit())).not.toContain("-password");
  });

  it("records settings, maintenance, buckets, credentials and downloads", async () => {
    enableVault();
    try {
      const { admin } = await seedPeople();
      const as = (path: string, method = "GET", body?: unknown) =>
        app.request(path, {
          ...(body === undefined ? {} : json(body)),
          method,
          headers: { "Content-Type": "application/json", cookie: admin },
        });

      await as("/api/settings/org_name", "PUT", { value: "Example Ltd" });
      await as("/api/system/maintenance", "POST", { refuse_chats: false });
      await as("/api/buckets", "POST", { slug: "manuals", name: "Manuals" });
      await as("/api/buckets/manuals/token", "POST");
      await as("/api/buckets/manuals", "DELETE");
      await as("/api/me/credentials/anthropic_api_key", "PUT", {
        value: "sk-ant-api03-kept-out-of-the-trail",
      });
      await as("/api/me/credentials/anthropic_api_key", "DELETE");
      await as("/api/me/credentials/anthropic_api_key", "DELETE");
      await as("/api/source-connections", "POST", {
        sourceType: "github",
        slug: "gh",
      });
      await as("/api/source-connections/gh", "DELETE");
      const [{ id: userId }] =
        await sql`select id from users where email = 'root@example.com'`;
      const output = await createOutput({
        userId: userId as string,
        utility: "export_table",
        filename: "escalations.csv",
        mime: "text/csv",
        bytes: new TextEncoder().encode("a,b\n"),
        meta: { rows: 1, columns: 2 },
      });
      await as(`/api/outputs/${output.id}/download`);

      expect((await actions()).slice(0, 10).reverse()).toEqual([
        "setting_set",
        "maintenance_set",
        "bucket_create",
        "bucket_token_rotate",
        "bucket_delete",
        "credential_set",
        "credential_delete",
        "source_connection_save",
        "source_connection_delete",
        "output_download",
      ]);
      expect(JSON.stringify(await listAudit())).not.toContain("kept-out");
    } finally {
      disableVault();
    }
  });

  it("shows the trail to app admins only", async () => {
    const { admin, member } = await seedPeople();
    await setTeamMember("test-team", "sam@example.com", "admin");
    const read = (cookie: string, query = "") =>
      app.request(`/api/audit${query}`, { headers: { cookie } });

    expect((await read(member)).status).toBe(403);
    const response = await read(admin, "?action=login&limit=1");
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(1);
    expect((await read(admin, "?action=nonsense")).status).toBe(400);
  });

  it("records who ran setup", async () => {
    const response = await app.request(
      "/api/setup",
      json({
        email: "first@example.com",
        password: "a-long-password",
        setup_code: setupCode(),
      }),
    );
    expect(cookieOf(response)).not.toBe("");
    expect((await listAudit())[0]).toMatchObject({
      action: "setup",
      target: "first@example.com",
      actor_email: "first@example.com",
    });
  });
});

describe("what the chat tools record", () => {
  it("records a catalog write once it has happened, and not a refused one", async () => {
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientTransport);
    const call = (name: string, args: Record<string, unknown>) =>
      client.callTool({ name, arguments: args }) as Promise<{
        isError?: boolean;
      }>;

    expect(
      (await call("add_team", { slug: "ops", name: "Ops" })).isError,
    ).not.toBe(true);
    await call("add_customer", { name: "Acme", slug: "acme" });
    await call("export_table", {
      columns: [{ key: "a", label: "A" }],
      rows: [{ a: 1 }],
    });
    expect(
      (await call("add_product", { team_slug: "nope", slug: "x", name: "X" }))
        .isError,
    ).toBe(true);

    const events = await listAudit();
    expect(events.map((e) => [e.action, e.actor])).toEqual([
      ["export", "mcp"],
      ["catalog_add", "mcp"],
      ["catalog_add", "mcp"],
    ]);
    expect(events.map((e) => e.target).slice(1)).toEqual([
      "customer:acme",
      "team:ops",
    ]);
  });
});

describe("an event's detail as text", () => {
  it("joins what is set and drops what is not", () => {
    expect(detailText({ role: "admin", with_password: true, team: null })).toBe(
      "role: admin · with password: true",
    );
    expect(detailText({ teams: ["a", "b"] })).toBe('teams: ["a","b"]');
    expect(detailText({})).toBe("");
  });
});

describe("what a change in the admin pages records", () => {
  const send = (cookie: string, method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  /** Oldest first, without the sign-ins the test's own cookies made. */
  const changes = async () =>
    (await listAudit())
      .filter((e) => e.action !== "login")
      .reverse()
      .map((e) => `${e.action} ${e.target}`);

  it("records the catalogue: teams, products, components, labels and patterns", async () => {
    const { admin } = await seedPeople();
    const steps: [string, string, unknown?][] = [
      ["POST", "/teams", { slug: "ops", name: "Ops" }],
      ["PATCH", "/teams/ops", { name: "Operations" }],
      ["POST", "/products", { team_slug: "ops", slug: "gw", name: "Gateway" }],
      ["PATCH", "/products/gw", { name: "Gateway 2" }],
      ["POST", "/products/gw/components", { slug: "relay", name: "Relay" }],
      ["PATCH", "/products/gw/components/relay", { name: "Relay box" }],
      ["POST", "/products/gw/components/relay/rename", { to: "relay-box" }],
      ["DELETE", "/products/gw/components/relay-box"],
      ["POST", "/products/gw/labels", { slug: "urgent" }],
      ["PATCH", "/products/gw/labels/urgent", { description: "drop the rest" }],
      ["POST", "/products/gw/labels/urgent/rename", { to: "hot" }],
      ["DELETE", "/products/gw/labels/hot"],
      ["POST", "/resolution-patterns", { slug: "restart", description: "x" }],
      ["PATCH", "/resolution-patterns/restart", { description: "y" }],
      ["POST", "/resolution-patterns/restart/rename", { to: "reboot" }],
      ["DELETE", "/resolution-patterns/reboot"],
      ["DELETE", "/products/gw"],
      ["DELETE", "/teams/ops"],
    ];
    for (const [method, path, body] of steps) {
      const response = await send(admin, method, path, body);
      expect(response.status, `${method} ${path}`).toBe(200);
    }

    expect(await changes()).toEqual([
      "catalog_add team:ops",
      "catalog_update team:ops",
      "catalog_add product:ops/gw",
      "catalog_update product:gw",
      "catalog_add component:gw/relay",
      "catalog_update component:gw/relay",
      "catalog_update component:gw/relay",
      "catalog_delete component:gw/relay-box",
      "catalog_add label:gw/urgent",
      "catalog_update label:gw/urgent",
      "catalog_update label:gw/urgent",
      "catalog_delete label:gw/hot",
      "catalog_add pattern:restart",
      "catalog_update pattern:restart",
      "catalog_update pattern:restart",
      "catalog_delete pattern:reboot",
      "catalog_delete product:gw",
      "catalog_delete team:ops",
    ]);
    const renamed = (await listAudit()).filter((e) => e.detail.renamed_to);
    expect(renamed.map((e) => e.detail.renamed_to).sort()).toEqual([
      "hot",
      "reboot",
      "relay-box",
    ]);
  });

  it("records customers and what is set on them, without a fact's value", async () => {
    const { admin } = await seedPeople();
    await setTeamMember("test-team", "root@example.com", "admin");
    const steps: [string, string, unknown?][] = [
      ["POST", "/customers", { name: "Acme", slug: "acme" }],
      ["PATCH", "/customers/acme", { notes: "pilot" }],
      [
        "PUT",
        "/customers/acme/units",
        { slug: "plant-1", name: "Plant 1", kind: "site" },
      ],
      ["PATCH", "/customers/acme/units/plant-1", { name: "Plant one" }],
      [
        "PUT",
        "/customers/acme/facts",
        { kind: "version", label: "controller", value: "9.4.1-internal" },
      ],
      ["DELETE", "/customers/acme/units/plant-1"],
      ["DELETE", "/customers/acme"],
    ];
    for (const [method, path, body] of steps) {
      const response = await send(admin, method, path, body);
      expect(response.status, `${method} ${path}`).toBe(200);
    }

    expect(await changes()).toEqual([
      "catalog_add customer:acme",
      "catalog_update customer:acme",
      "catalog_add unit:acme/plant-1",
      "catalog_update unit:acme/plant-1",
      "catalog_update customer:acme",
      "catalog_delete unit:acme/plant-1",
      "catalog_delete customer:acme",
    ]);
    const fact = (await listAudit()).find((e) => e.detail.fact_set);
    expect(fact?.detail).toMatchObject({
      fact_set: "version",
      label: "controller",
    });
    expect(JSON.stringify(await listAudit())).not.toContain("9.4.1-internal");
  });

  it("records repos, source projects and flows", async () => {
    const { admin } = await seedPeople();

    const linked = await send(admin, "PUT", "/repos", {
      slug: "driver",
      url: "https://deploy:hunter2@example.invalid/driver.git",
      product: "tpd",
    });
    expect(linked.status).toBe(200);
    expect((await send(admin, "DELETE", "/repos/driver")).status).toBe(200);

    const project = await send(admin, "POST", "/source-projects", {
      source_slug: "test-freshdesk",
      external_key: "777",
      product_slug: "tpd",
    });
    expect(project.status).toBe(200);
    const projectId = (await project.json()).id as string;
    expect(
      (
        await send(admin, "PATCH", `/source-projects/${projectId}`, {
          name: "Second line",
        })
      ).status,
    ).toBe(200);
    expect(
      (await send(admin, "DELETE", `/source-projects/${projectId}`)).status,
    ).toBe(200);

    const flow = await send(admin, "POST", "/flows", {
      name: "triage",
      team: null,
      enabled: false,
      graph: { triggers: [{ id: "m", kind: "manual" }], steps: [] },
    });
    expect(flow.status).toBe(201);
    const flowId = (await flow.json()).id as string;
    expect((await send(admin, "DELETE", `/flows/${flowId}`)).status).toBe(204);

    expect(await changes()).toEqual([
      "repo_link driver",
      "repo_delete driver",
      "source_project_save test-freshdesk/777",
      "source_project_save test-freshdesk/777",
      "source_project_delete test-freshdesk/777",
      "flow_save triage",
      "flow_delete triage",
    ]);
    const link = (await listAudit()).find((e) => e.action === "repo_link");
    expect(link?.detail.url).toBe("https://example.invalid/driver.git");
    expect(link?.actor_email).toBe("root@example.com");
  });

  it("records nothing for a change that was refused or failed", async () => {
    const { admin, member } = await seedPeople();
    expect(
      (await send(member, "POST", "/teams", { slug: "ops", name: "Ops" }))
        .status,
    ).toBe(403);
    expect((await send(member, "DELETE", "/customers/acme")).status).toBe(403);
    expect(
      (await send(admin, "DELETE", "/teams/no-such-team")).status,
    ).not.toBe(200);
    expect(await changes()).toEqual([]);
  });
});
