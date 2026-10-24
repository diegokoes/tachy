import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createUser, setTeamMember } from "@tachy/core/access";
import { createBucket } from "@tachy/core/buckets";
import { checkMentions, listMentionables } from "@tachy/core/chat";
import { linkRepo } from "@tachy/core/code";
import type { AgentEvent, AgentTurn } from "@tachy/agent";
import { createApp } from "../../packages/api/src/app";
import { json, loginCookie } from "../http";
import { resetData, sql } from "../database";

const prompts: string[] = [];

/** A turn that ends at once, so the route's prompt is all that is checked. */
class EmptyTurn implements AgentTurn {
  finished = false;
  pendingApprovals = 0;
  oldestPendingApprovalAt = null;
  approve() {}
  abort() {}
  async *events(): AsyncGenerator<AgentEvent> {
    this.finished = true;
  }
}

vi.mock("@tachy/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tachy/agent")>()),
  startTurn: (prompt: string) => {
    prompts.push(prompt);
    return new EmptyTurn();
  },
}));

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });
const GROUP_KEY = "48000641379";
let memberId = "";
let outsiderId = "";

beforeEach(async () => {
  await resetData();
  prompts.length = 0;
  memberId = (
    await createUser({ email: "in@example.com", password: "a-long-password" })
  ).id;
  outsiderId = (
    await createUser({ email: "out@example.com", password: "a-long-password" })
  ).id;
  await setTeamMember("test-team", "in@example.com", "member");
  await createBucket(
    { slug: "guides", name: "Guides", teams: ["test-team"] },
    null,
  );
  await createBucket({ slug: "private", name: "Private" }, null);
  const [group] = await sql<{ id: string }[]>`
    select id from source_projects where external_key = ${GROUP_KEY}
  `;
  await linkRepo({
    slug: "billing-api",
    url: "https://example.test/billing.git",
    productSlug: "tpd",
    sourceProjectId: group.id,
  });
});

describe("mentionables", () => {
  it("lists every repo, its projects, and the buckets shared with the user", async () => {
    expect(await listMentionables(memberId)).toEqual({
      repos: [{ slug: "billing-api", product_slug: "tpd", project: GROUP_KEY }],
      buckets: [{ slug: "guides", name: "Guides" }],
      projects: [GROUP_KEY],
    });
    expect((await listMentionables(outsiderId)).buckets).toEqual([]);
  });

  it("is what the picker gets for the signed-in user", async () => {
    const cookie = await loginCookie(app, "out@example.com", "a-long-password");
    const response = await app.request("/api/agent/mentions", {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    const listed = await response.json();
    expect(listed.repos.map((r: { slug: string }) => r.slug)).toEqual([
      "billing-api",
    ]);
    expect(listed.buckets).toEqual([]);
  });
});

describe("checkMentions", () => {
  it("passes what the user may attach", async () => {
    await expect(
      checkMentions(memberId, [
        { kind: "repo", key: "billing-api" },
        { kind: "bucket", key: "guides" },
        { kind: "project", key: GROUP_KEY },
      ]),
    ).resolves.toBeUndefined();
  });

  it("names the first thing that is missing or not shared", async () => {
    await expect(
      checkMentions(memberId, [{ kind: "repo", key: "nope" }]),
    ).rejects.toThrow(/repo 'nope' not found/);
    await expect(
      checkMentions(memberId, [{ kind: "bucket", key: "private" }]),
    ).rejects.toThrow(/not shared with any of your teams/);
    await expect(
      checkMentions(memberId, [{ kind: "project", key: "Elsewhere" }]),
    ).rejects.toThrow(/no linked repo belongs to a project 'Elsewhere'/);
  });
});

describe("a chat turn with mentions and a mode", () => {
  const chat = async (body: Record<string, unknown>) =>
    app.request("/api/agent/chat", {
      ...json({ message: "why?", ...body }),
      headers: {
        "Content-Type": "application/json",
        Cookie: await loginCookie(app, "in@example.com", "a-long-password"),
      },
    });

  it("puts the mode and the sources in front of the message", async () => {
    const response = await chat({
      mode: { name: "analyze", args: "test-freshdesk 12" },
      mentions: [
        { kind: "repo", key: "billing-api" },
        { kind: "bucket", key: "guides" },
      ],
    });
    expect(response.status).toBe(200);
    await response.text();
    expect(prompts[0]).toContain('<mode name="analyze">');
    expect(prompts[0]).toContain("Ticket: test-freshdesk 12");
    expect(prompts[0]).toContain("repos: billing-api");
    expect(prompts[0]).toContain("buckets: guides");
  });

  it("refuses a bucket the user may not read, before any turn starts", async () => {
    const response = await chat({
      mentions: [{ kind: "bucket", key: "private" }],
    });
    expect(response.status).toBe(403);
    expect(prompts).toEqual([]);
  });

  it("refuses a mode it does not know", async () => {
    const response = await chat({ mode: { name: "consult" } });
    expect(response.status).toBe(400);
  });
});

describe("the command list", () => {
  it("offers the modes, and flags the commands only a control sends", async () => {
    const response = await app.request("/api/agent/commands", {
      headers: {
        Cookie: await loginCookie(app, "in@example.com", "a-long-password"),
      },
    });
    const listed = await response.json();
    expect(listed.modes.map((m: { name: string }) => m.name)).toEqual([
      "analyze",
      "code",
    ]);
    const hidden = listed.builtins
      .filter((b: { hidden?: boolean }) => b.hidden)
      .map((b: { name: string }) => b.name);
    expect(hidden).toEqual(["walkthrough", "ingest-wiki", "wiki-draft"]);
  });
});
