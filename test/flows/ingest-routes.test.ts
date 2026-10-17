/**
 * The ingest editor's routes: who reads and changes a connection's rules, the
 * preview on a stored ticket, and the lists the rule editor offers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearPermissionCache,
  createUser,
  setTeamMember,
} from "@tachy/core/access";
import { listOptions } from "@tachy/core/flows";
import { addSourceConnection, registerSource } from "@tachy/core/sources";
import { ingestWorkItem } from "@tachy/core/work-items";
import { createApp } from "../../packages/api/src/app";
import { loginCookie } from "../http";
import { resetData, sql } from "../database";

const ANALYSIS = "AI analysis of the ticket, at great length and no substance.";

registerSource("fake-ingest-api", () => ({
  type: "fake-ingest-api",
  capabilities: { postNote: false, incrementalSync: false },
  modelOmits: ["description_text"],
  async fetchItem() {
    throw new Error("not used");
  },
  async listItems() {
    return { items: [] };
  },
  async verify() {
    return { identity: "agent@example.invalid", groups: [] };
  },
  async options(name: string) {
    if (name === "agents") return [{ value: "900", label: "A. Manager" }];
    if (name === "groups") return [{ value: "12", label: "Second level" }];
    return [];
  },
}));

afterAll(() => sql.end());

const rule = {
  id: "manager",
  label: "Manager analysis",
  enabled: true,
  where: { field: "message.author", op: "eq", value: "900" },
};

describe("ingest routes", () => {
  const app = createApp({ passwordAuth: true });
  let rootCookie: string;
  let leadCookie: string;
  let devCookie: string;
  let ticketId: string;

  const request = (cookie: string, path: string, init: RequestInit = {}) =>
    app.request(`/api/flows/ingest/fd-api${path}`, {
      ...init,
      headers: { cookie, "Content-Type": "application/json" },
    });

  beforeAll(async () => {
    await resetData();
    clearPermissionCache();
    const conn = await addSourceConnection({
      sourceType: "fake-ingest-api",
      slug: "fd-api",
      baseUrl: "https://example.invalid",
      config: { redaction: { enabled: true } },
    });
    ticketId = (
      await ingestWorkItem(conn.id, {
        externalId: "5",
        kind: "ticket",
        title: "Labels print blank",
        groupKey: "12",
        raw: { subject: "Labels print blank", description_text: "Blank." },
        messages: [
          {
            externalId: "desc-5",
            direction: "incoming",
            visibility: "public",
            bodyText: "Blank.",
            createdAt: "2026-10-01T08:00:00Z",
          },
          {
            externalId: "6",
            author: "900",
            authorLabel: "A. Manager",
            direction: "outgoing",
            visibility: "private",
            bodyText: ANALYSIS,
            createdAt: "2026-10-01T09:00:00Z",
          },
        ],
      })
    ).id;
    await createUser({
      email: "root@example.com",
      role: "admin",
      password: "root-password",
    });
    await createUser({
      email: "lead@example.com",
      role: "member",
      password: "lead-password",
    });
    await createUser({
      email: "dev@example.com",
      role: "member",
      password: "dev-password",
    });
    await setTeamMember("test-team", "lead@example.com", "admin");
    await setTeamMember("test-team", "dev@example.com", "member");
    rootCookie = await loginCookie(app, "root@example.com", "root-password");
    leadCookie = await loginCookie(app, "lead@example.com", "lead-password");
    devCookie = await loginCookie(app, "dev@example.com", "dev-password");
  });

  it("lets an app admin save the rules, beside the connection's other settings", async () => {
    const body = JSON.stringify({ skip: [rule], guidance: { "12": "Logs." } });
    const denied = await request(leadCookie, "", { method: "PUT", body });
    expect(denied.status).toBe(403);
    const saved = await request(rootCookie, "", { method: "PUT", body });
    expect(saved.status).toBe(200);
    expect((await saved.json()).skip).toEqual([rule]);

    const [row] =
      await sql`select config from source_connections where slug = 'fd-api'`;
    expect(row.config.redaction).toEqual({ enabled: true });
    const [audit] = await sql`
      select detail from audit_events where action = 'source_connection_save'
      order by id desc limit 1
    `;
    expect(audit.detail).toMatchObject({ part: "ingest", skip_rules: 1 });
  });

  it("refuses a rule that does not parse", async () => {
    const response = await request(rootCookie, "", {
      method: "PUT",
      body: JSON.stringify({ skip: [{ ...rule, id: "has spaces" }] }),
    });
    expect(response.status).toBe(400);
  });

  it("shows team admins the rules and not other members", async () => {
    expect((await request(devCookie, "")).status).toBe(403);
    const shown = await request(leadCookie, "");
    expect(shown.status).toBe(200);
    expect((await shown.json()).guidance).toEqual({ "12": "Logs." });
  });

  it("previews an unsaved config on a stored ticket", async () => {
    const response = await request(leadCookie, "/preview", {
      method: "POST",
      body: JSON.stringify({
        work_item_id: ticketId,
        config: { skip: [rule] },
      }),
    });
    expect(response.status).toBe(200);
    const preview = await response.json();
    expect(
      preview.messages.map((m: { skipped_by: string | null }) => m.skipped_by),
    ).toEqual([null, "manager"]);
    expect(preview.chars.read).toBeLessThan(
      preview.chars.stored - ANALYSIS.length,
    );
    expect(preview.guidance).toBeNull();
  });

  it("previews for someone with no token of their own for the source", async () => {
    registerSource("fake-needs-token", () => {
      throw new Error("Missing token");
    });
    const conn = await addSourceConnection({
      sourceType: "fake-needs-token",
      slug: "fd-tokenless",
      baseUrl: "https://example.invalid",
    });
    const stored = await ingestWorkItem(conn.id, {
      externalId: "8",
      kind: "ticket",
      raw: {},
      messages: [
        {
          externalId: "9",
          author: "900",
          direction: "outgoing",
          visibility: "private",
          bodyText: ANALYSIS,
        },
      ],
    });
    const response = await app.request(
      "/api/flows/ingest/fd-tokenless/preview",
      {
        method: "POST",
        headers: { cookie: leadCookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          work_item_id: stored.id,
          config: { skip: [rule] },
        }),
      },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).messages[0].skipped_by).toBe("manager");
  });

  it("refuses a preview of another connection's ticket", async () => {
    await addSourceConnection({
      sourceType: "fake-ingest-api",
      slug: "fd-other",
      baseUrl: "https://example.invalid",
    });
    const response = await app.request("/api/flows/ingest/fd-other/preview", {
      method: "POST",
      headers: { cookie: leadCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ work_item_id: ticketId, config: {} }),
    });
    expect(response.status).toBe(404);
  });
});

describe("the rule editor's lists", () => {
  const request = (params: Record<string, string>) => ({
    scope: {},
    params: { connection: "fd-api", ...params },
  });

  it("lists a message field's values, the author from the source's people", async () => {
    expect(
      await listOptions("ingest.values", request({ field: "message.author" })),
    ).toEqual([{ value: "900", label: "A. Manager" }]);
    expect(
      (
        await listOptions(
          "ingest.values",
          request({ field: "message.visibility" }),
        )
      ).map((o) => o.value),
    ).toEqual(["public", "private", "internal"]);
    expect(
      await listOptions("ingest.values", request({ field: "message.body" })),
    ).toEqual([]);
  });

  it("lists an item field's values from the stored items", async () => {
    const values = await listOptions(
      "ingest.values",
      request({ field: "item.group" }),
    );
    expect(values.map((o) => o.value)).toContain("12");
  });

  it("lists groups from the source when its probe reads none", async () => {
    expect(await listOptions("source.groups", request({}))).toEqual([
      { value: "12", label: "Second level" },
    ]);
  });
});
