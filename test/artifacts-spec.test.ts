import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createUser,
  getArtifactBySlug,
  listVisibleArtifacts,
  upsertArtifact,
  type ArtifactSpec,
} from "@tachy/core";
import { createApp } from "../packages/api/src/app";
import { buildPrompt } from "../packages/api/src/routes/agent";
import { server } from "../packages/mcp/src/index";
import { loginCookie, resetData, sql } from "./helpers";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });
const login = (email: string) => loginCookie(app, email, "a-long-password");

const SPEC: ArtifactSpec = {
  utilities: ["export_table"],
  output: {
    format: "xlsx",
    sheet: "Tickets",
    filename: "escalations-{date}",
    columns: [
      {
        key: "ticket_id",
        label: "Ticket",
        type: "string",
        required: true,
        description: "the source ticket id",
      },
      { key: "customer", label: "Customer", type: "string" },
      { key: "opened_at", label: "Opened", type: "date" },
    ],
  },
};

const alice = () =>
  createUser({ email: "alice@example.com", password: "a-long-password" });

beforeEach(resetData);

describe("artifact spec persistence", () => {
  it("round-trips through upsert, list and slug lookup", async () => {
    const user = await alice();
    await upsertArtifact(user.id, "user", user.id, "escalation-register", {
      title: "Escalation register",
      body: "One row per escalated ticket.",
      spec: SPEC,
    });

    const [listed] = await listVisibleArtifacts({ userId: user.id });
    expect(listed.spec?.output?.columns.map((c) => c.key)).toEqual([
      "ticket_id",
      "customer",
      "opened_at",
    ]);
    expect(listed.spec?.utilities).toEqual(["export_table"]);

    const bySlug = await getArtifactBySlug("escalation-register", {
      userId: user.id,
    });
    expect(bySlug?.spec?.output?.sheet).toBe("Tickets");
    expect(bySlug?.body).toContain("One row per");
  });

  it("keeps spec null for a plain prompt artifact", async () => {
    const user = await alice();
    await upsertArtifact(user.id, "user", user.id, "plain", {
      title: "Plain",
      body: "just a prompt",
    });
    const [listed] = await listVisibleArtifacts({ userId: user.id });
    expect(listed.spec).toBeNull();
  });

  it("drops a stored spec that no longer parses rather than throwing", async () => {
    const user = await alice();
    await upsertArtifact(user.id, "user", user.id, "legacy", {
      title: "Legacy",
      body: "b",
      spec: SPEC,
    });
    await sql`update artifacts set spec = ${sql.json({ output: { format: "pdf" } } as never)} where slug = 'legacy'`;
    const [listed] = await listVisibleArtifacts({ userId: user.id });
    expect(listed.spec).toBeNull();
  });

  it("rejects an unknown key or a bad column through the route", async () => {
    await alice();
    const cookie = await login("alice@example.com");
    const bad = [
      { ...SPEC, nope: 1 },
      { output: { format: "pdf", columns: [{ key: "a" }] } },
      { output: { format: "xlsx", columns: [] } },
    ];
    for (const spec of bad) {
      const res = await app.request("/api/artifacts", {
        method: "PUT",
        body: JSON.stringify({
          scope: "user",
          slug: "x",
          title: "x",
          body: "x",
          spec,
        }),
        headers: { "Content-Type": "application/json", cookie },
      });
      expect(res.status).toBe(400);
    }
  });

  it("applies the column type default on the way in", async () => {
    await alice();
    const cookie = await login("alice@example.com");
    const res = await app.request("/api/artifacts", {
      method: "PUT",
      body: JSON.stringify({
        scope: "user",
        slug: "defaults",
        title: "Defaults",
        body: "b",
        spec: { output: { columns: [{ key: "ticket_id" }] } },
      }),
      headers: { "Content-Type": "application/json", cookie },
    });
    expect(res.status).toBe(200);

    const list = await app.request("/api/artifacts", { headers: { cookie } });
    const [row] = (await list.json()) as { spec: ArtifactSpec }[];
    expect(row.spec.output).toMatchObject({
      format: "xlsx",
      columns: [{ key: "ticket_id", type: "string" }],
    });
  });
});

describe("buildPrompt output contract", () => {
  it("appends the contract after the artifact block", () => {
    const prompt = buildPrompt({
      message: "fill the register for FD-1 and FD-2",
      artifact: {
        slug: "escalation-register",
        title: "Escalation register",
        body: "One row per escalated ticket.",
        spec: SPEC,
      },
    });
    expect(prompt.indexOf("<artifact")).toBe(0);
    expect(prompt.indexOf("<output-contract")).toBeGreaterThan(
      prompt.indexOf("</artifact>"),
    );
    expect(prompt).toContain(
      "ticket_id (string, required) — the source ticket id",
    );
    expect(prompt).toContain("opened_at (date)");
    expect(prompt.indexOf("fill the register")).toBeGreaterThan(
      prompt.indexOf("</output-contract>"),
    );
  });

  it("stays silent when the artifact declares no output", () => {
    const prompt = buildPrompt({
      message: "hi",
      artifact: { slug: "plain", title: "Plain", body: "b" },
    });
    expect(prompt).not.toContain("<output-contract");
  });
});

describe("export_table", () => {
  interface ToolResult {
    content: { text: string }[];
    isError?: boolean;
  }

  /** Parses through the tool's own input schema first, so defaults land as they do in production. */
  async function call(input: Record<string, unknown>): Promise<ToolResult> {
    const entry = (
      server as unknown as {
        _registeredTools: Record<
          string,
          {
            inputSchema: { parse: (v: unknown) => unknown };
            handler: (a: unknown, e: unknown) => Promise<ToolResult>;
          }
        >;
      }
    )._registeredTools["export_table"];
    return entry.handler(entry.inputSchema.parse(input), {});
  }

  async function seedGlobalRegister() {
    const admin = await createUser({
      email: "root@example.com",
      password: "a-long-password",
      role: "admin",
    });
    await upsertArtifact(admin.id, "global", undefined, "escalation-register", {
      title: "Escalation register",
      body: "One row per escalated ticket.",
      spec: SPEC,
    });
    return admin;
  }

  it("fills an artifact's declared columns and returns a descriptor, not bytes", async () => {
    await seedGlobalRegister();

    const res = await call({
      artifact_slug: "escalation-register",
      rows: [
        {
          ticket_id: "FD-1",
          customer: "Acme",
          opened_at: "2026-08-01T09:30:00Z",
        },
        { ticket_id: "FD-2", customer: null, opened_at: null },
      ],
    });
    expect(res.isError).toBeFalsy();

    const { output } = JSON.parse(res.content[0].text) as {
      output: Record<string, unknown>;
    };
    expect(output.rows).toBe(2);
    expect(output.columns).toBe(3);
    expect(output.filename).toMatch(/^escalations-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(output.url).toBe(`/api/outputs/${output.id}/download`);
    expect(res.content[0].text).not.toContain("PK");

    const [row] =
      await sql`select byte_size, artifact_id from generated_outputs where id = ${output.id as string}`;
    expect(row.byte_size).toBeGreaterThan(0);
    expect(row.artifact_id).toBeTruthy();
  });

  it("rejects rows that break the contract so the model can retry", async () => {
    await seedGlobalRegister();

    const extra = await call({
      artifact_slug: "escalation-register",
      rows: [{ ticket_id: "FD-1", severity: "high" }],
    });
    expect(extra.isError).toBe(true);
    expect(extra.content[0].text).toContain('unknown column "severity"');

    const missing = await call({
      artifact_slug: "escalation-register",
      rows: [{ customer: "Acme" }],
    });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain('"ticket_id" is required');
  });

  it("cannot reach another user's artifact when no user is ambient", async () => {
    const user = await alice();
    await upsertArtifact(user.id, "user", user.id, "private-register", {
      title: "Private register",
      body: "b",
      spec: SPEC,
    });
    const res = await call({
      artifact_slug: "private-register",
      rows: [{ ticket_id: "FD-1" }],
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("no artifact 'private-register'");
  });

  it("works without an artifact when columns are passed directly", async () => {
    const res = await call({
      format: "csv",
      columns: [{ key: "name" }, { key: "count", type: "number" }],
      rows: [{ name: "acme", count: 2 }],
    });
    expect(res.isError).toBeFalsy();
    const { output } = JSON.parse(res.content[0].text) as {
      output: { filename: string; mime: string };
    };
    expect(output.filename).toMatch(/\.csv$/);
    expect(output.mime).toMatch(/text\/csv/);
  });

  it("refuses when neither an artifact nor columns say what the shape is", async () => {
    const res = await call({ rows: [{ a: 1 }] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("no columns");
  });
});
