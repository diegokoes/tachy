import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createUser,
  addTeam,
  setTeamMember,
  getTeamIdBySlug,
  listVisibleArtifacts,
  getArtifact,
  upsertArtifact,
  deleteArtifact,
} from "@tachy/core";
import { createApp } from "../packages/api/src/app";
import { buildPrompt } from "../packages/api/src/routes/agent";
import { loginCookie, resetData, sql } from "./helpers";

afterAll(() => sql.end());

async function seedPeople() {
  const admin = await createUser({
    email: "root@example.com",
    password: "a-long-password",
    role: "admin",
  });
  const alice = await createUser({
    email: "alice@example.com",
    password: "a-long-password",
  });
  const bob = await createUser({
    email: "bob@example.com",
    password: "a-long-password",
  });
  await addTeam("hw", "Hardware");
  await addTeam("sw", "Software");
  const teamId = await getTeamIdBySlug("hw");
  const otherTeamId = await getTeamIdBySlug("sw");
  await setTeamMember("hw", "alice@example.com", "admin");
  await setTeamMember("hw", "bob@example.com", "member");
  return { admin, alice, bob, teamId, otherTeamId };
}

beforeEach(resetData);

describe("artifact visibility (user ∪ team ∪ global)", () => {
  it("lists own + team + global rows, ordered most-specific first", async () => {
    const { admin, alice, bob, teamId } = await seedPeople();
    await upsertArtifact(admin.id, "global", undefined, "org-wide", {
      title: "Org wide",
      body: "g",
    });
    await upsertArtifact(alice.id, "team", teamId, "team-style", {
      title: "Team style",
      body: "t",
    });
    await upsertArtifact(alice.id, "user", alice.id, "mine", {
      title: "Mine",
      body: "u",
    });
    await upsertArtifact(bob.id, "user", bob.id, "bobs", {
      title: "Bobs",
      body: "b",
    });

    const alicesView = await listVisibleArtifacts({
      userId: alice.id,
      teamId,
    });
    expect(alicesView.map((a) => a.slug)).toEqual([
      "mine",
      "team-style",
      "org-wide",
    ]);

    const bobsView = await listVisibleArtifacts({ userId: bob.id, teamId });
    expect(bobsView.map((a) => a.slug)).toEqual([
      "bobs",
      "team-style",
      "org-wide",
    ]);

    const outsider = await listVisibleArtifacts({ userId: admin.id });
    expect(outsider.map((a) => a.slug)).toEqual(["org-wide"]);
  });

  it("getArtifact rejects rows outside the caller's visibility", async () => {
    const { alice, bob, teamId } = await seedPeople();
    await upsertArtifact(alice.id, "user", alice.id, "mine", {
      title: "Mine",
      body: "u",
    });
    const [row] = await listVisibleArtifacts({ userId: alice.id, teamId });
    await expect(
      getArtifact(row.id, { userId: alice.id }),
    ).resolves.toMatchObject({
      slug: "mine",
      body: "u",
    });
    await expect(getArtifact(row.id, { userId: bob.id })).rejects.toThrow(
      /not found/,
    );
  });
});

describe("artifact write guards", () => {
  it("members write only their own user scope; team needs team-admin; global needs admin", async () => {
    const { admin, alice, bob, teamId, otherTeamId } = await seedPeople();

    await expect(
      upsertArtifact(bob.id, "user", alice.id, "x", { title: "x", body: "x" }),
    ).rejects.toThrow(/own/);
    await expect(
      upsertArtifact(bob.id, "team", teamId, "x", { title: "x", body: "x" }),
    ).rejects.toThrow(/admin/);
    await expect(
      upsertArtifact(alice.id, "team", otherTeamId, "x", {
        title: "x",
        body: "x",
      }),
    ).rejects.toThrow(/admin/);
    await expect(
      upsertArtifact(alice.id, "global", undefined, "x", {
        title: "x",
        body: "x",
      }),
    ).rejects.toThrow(/admin/);

    await upsertArtifact(alice.id, "team", teamId, "ok", {
      title: "ok",
      body: "ok",
    });
    await upsertArtifact(admin.id, "global", undefined, "ok", {
      title: "ok",
      body: "ok",
    });
  });

  it("rejects malformed slugs and upserts instead of duplicating", async () => {
    const { alice } = await seedPeople();
    await expect(
      upsertArtifact(alice.id, "user", alice.id, "Bad Slug!", {
        title: "x",
        body: "x",
      }),
    ).rejects.toThrow(/slug/);

    await upsertArtifact(alice.id, "user", alice.id, "dup", {
      title: "one",
      body: "one",
    });
    await upsertArtifact(alice.id, "user", alice.id, "dup", {
      title: "two",
      body: "two",
    });
    const rows = await listVisibleArtifacts({ userId: alice.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("two");

    expect(await deleteArtifact(alice.id, "user", alice.id, "dup")).toBe(true);
    expect(await deleteArtifact(alice.id, "user", alice.id, "dup")).toBe(false);
  });
});

describe("artifacts API", () => {
  const app = createApp({ passwordAuth: true });
  const login = (email: string) => loginCookie(app, email, "a-long-password");

  it("round-trips create → list → get → delete through the routes", async () => {
    await seedPeople();
    const cookie = await login("alice@example.com");

    const put = await app.request("/api/artifacts", {
      method: "PUT",
      body: JSON.stringify({
        scope: "user",
        slug: "docs-report",
        title: "Docs report",
        description: "style for docs reports",
        body: "Write a report structured as…",
      }),
      headers: { "Content-Type": "application/json", cookie },
    });
    expect(put.status).toBe(200);

    const list = await app.request("/api/artifacts", { headers: { cookie } });
    expect(list.status).toBe(200);
    const rows = (await list.json()) as { id: string; slug: string }[];
    expect(rows.map((r) => r.slug)).toContain("docs-report");
    expect(rows[0]).not.toHaveProperty("body");

    const got = await app.request(`/api/artifacts/${rows[0].id}`, {
      headers: { cookie },
    });
    expect(got.status).toBe(200);
    expect(((await got.json()) as { body: string }).body).toMatch(/structured/);

    const bobCookie = await login("bob@example.com");
    const invisible = await app.request(`/api/artifacts/${rows[0].id}`, {
      headers: { cookie: bobCookie },
    });
    expect(invisible.status).toBe(404);

    const del = await app.request("/api/artifacts", {
      method: "DELETE",
      body: JSON.stringify({ scope: "user", slug: "docs-report" }),
      headers: { "Content-Type": "application/json", cookie },
    });
    expect(del.status).toBe(200);
    expect(((await del.json()) as { deleted: boolean }).deleted).toBe(true);
  });

  it("a member cannot write team or global scope through the route", async () => {
    await seedPeople();
    const bobCookie = await login("bob@example.com");
    for (const payload of [
      { scope: "team", team: "hw", slug: "x", title: "x", body: "x" },
      { scope: "global", slug: "x", title: "x", body: "x" },
    ]) {
      const res = await app.request("/api/artifacts", {
        method: "PUT",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json", cookie: bobCookie },
      });
      expect(res.status).toBe(403);
    }
  });
});

describe("buildPrompt", () => {
  it("orders artifact block, uploads notice, then the message", () => {
    const prompt = buildPrompt({
      message: "improve the docs",
      uploadPaths: ["/tmp/a.pdf"],
      artifact: { title: "Docs report", body: "Use headings." },
    });
    const artifactAt = prompt.indexOf("<artifact");
    const uploadsAt = prompt.indexOf("uploaded these local files");
    const messageAt = prompt.indexOf("improve the docs");
    expect(artifactAt).toBe(0);
    expect(prompt).toContain('title="Docs report"');
    expect(prompt).toContain("Use headings.");
    expect(uploadsAt).toBeGreaterThan(artifactAt);
    expect(messageAt).toBeGreaterThan(uploadsAt);
  });

  it("is just the message when nothing is attached", () => {
    expect(buildPrompt({ message: "hi" })).toBe("hi");
  });
});
