import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  AppError,
  addTeam,
  countAdmins,
  createUser,
  getUserByEmail,
  listMemberships,
  listTeamMembers,
  listUsers,
  recordRun,
  setTeamMember,
  setUserDisabled,
  setUserDisplayName,
  setUserPassword,
  setUserRole,
  upsertUser,
  userSoleTeamId,
  userTeams,
  verifyPassword,
} from "@tachy/core";
import { resetData, sql } from "./helpers";

afterAll(() => sql.end());

beforeEach(resetData);

describe("upsertUser", () => {
  it("upserts by email and updates display name", async () => {
    const id1 = await upsertUser("eng@example.com");
    const id2 = await upsertUser("eng@example.com", "Engineer");
    expect(id1).toBe(id2);
    const [row] = await sql`select display_name from users where id = ${id1}`;
    expect(row.display_name).toBe("Engineer");
  });

  /** A later call with no name must not wipe the name an earlier one set. */
  it("keeps an existing display name when none is given", async () => {
    const id = await upsertUser("eng@example.com", "Engineer");
    await upsertUser("eng@example.com");
    const [row] = await sql`select display_name from users where id = ${id}`;
    expect(row.display_name).toBe("Engineer");
  });
});

describe("createUser", () => {
  it("creates a member with a working password", async () => {
    const user = await createUser({
      email: "new@example.com",
      displayName: "New Person",
      password: "a-long-password",
    });
    expect(user.role).toBe("member");
    expect(user.has_password).toBe(true);

    const found = await getUserByEmail("new@example.com");
    expect(await verifyPassword("a-long-password", found!.password_hash!)).toBe(
      true,
    );
  });

  it("creates a passwordless user for SSO", async () => {
    const user = await createUser({ email: "sso@example.com" });
    expect(user.has_password).toBe(false);
  });

  /**
   * `on conflict do nothing` returns no row, so this has to be an error rather
   * than a silent no-op — otherwise creating a duplicate looks like success and
   * hands back nothing to act on.
   */
  it("refuses an email that already exists", async () => {
    await createUser({ email: "dup@example.com" });
    await expect(createUser({ email: "dup@example.com" })).rejects.toThrow(
      /already exists/,
    );
  });
});

describe("getUserByEmail", () => {
  it("returns null rather than throwing for an unknown address", async () => {
    expect(await getUserByEmail("nobody@example.com")).toBeNull();
  });
});

describe("listUsers", () => {
  it("lists everyone in creation order, without password hashes", async () => {
    await createUser({ email: "a@example.com", password: "a-long-password" });
    await createUser({ email: "b@example.com" });
    const users = await listUsers();
    expect(users.map((u) => u.email)).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
    expect(users[0].has_password).toBe(true);
    expect(users[1].has_password).toBe(false);
    expect(Object.keys(users[0])).not.toContain("password_hash");
  });
});

/**
 * The last-admin guards. Both are the same shape and both matter: an instance
 * with no reachable admin cannot be repaired through the UI at all.
 */
describe("the last admin cannot be locked out", () => {
  it("refuses to demote the only admin", async () => {
    const admin = await createUser({
      email: "root@example.com",
      role: "admin",
    });
    await expect(setUserRole(admin.id, "member")).rejects.toThrow(/last admin/);
    expect(await countAdmins()).toBe(1);
  });

  it("refuses to disable the only admin", async () => {
    const admin = await createUser({
      email: "root@example.com",
      role: "admin",
    });
    await expect(setUserDisabled(admin.id, true)).rejects.toThrow(/last admin/);
  });

  it("allows either once a second admin exists", async () => {
    const first = await createUser({ email: "a@example.com", role: "admin" });
    await createUser({ email: "b@example.com", role: "admin" });
    await setUserRole(first.id, "member");
    expect(await countAdmins()).toBe(1);
  });

  /** A disabled admin is not a reachable one, so it does not hold the door. */
  it("does not count a disabled admin toward the quorum", async () => {
    const first = await createUser({ email: "a@example.com", role: "admin" });
    const second = await createUser({ email: "b@example.com", role: "admin" });
    await setUserDisabled(second.id, true);
    expect(await countAdmins()).toBe(1);
    await expect(setUserRole(first.id, "member")).rejects.toThrow(/last admin/);
  });

  it("promotes a member to admin without complaint", async () => {
    const user = await createUser({ email: "a@example.com" });
    await setUserRole(user.id, "admin");
    expect(await countAdmins()).toBe(1);
  });
});

describe("user field setters", () => {
  it("sets and clears a display name", async () => {
    const user = await createUser({ email: "a@example.com" });
    await setUserDisplayName(user.id, "Alice");
    expect((await listUsers())[0].display_name).toBe("Alice");
    await setUserDisplayName(user.id, null);
    expect((await listUsers())[0].display_name).toBeNull();
  });

  it("sets a password that verifies", async () => {
    const user = await createUser({ email: "a@example.com" });
    await setUserPassword(user.id, "another-long-password");
    const found = await getUserByEmail("a@example.com");
    expect(
      await verifyPassword("another-long-password", found!.password_hash!),
    ).toBe(true);
  });

  it("re-enables a disabled user", async () => {
    await createUser({ email: "root@example.com", role: "admin" });
    const user = await createUser({ email: "a@example.com" });
    await setUserDisabled(user.id, true);
    expect((await getUserByEmail("a@example.com"))!.disabled).toBe(true);
    await setUserDisabled(user.id, false);
    expect((await getUserByEmail("a@example.com"))!.disabled).toBe(false);
  });

  it.each([
    ["setUserRole", (id: string) => setUserRole(id, "member")],
    ["setUserDisplayName", (id: string) => setUserDisplayName(id, "x")],
    ["setUserPassword", (id: string) => setUserPassword(id, "a-long-password")],
    ["setUserDisabled", (id: string) => setUserDisabled(id, true)],
  ])(
    "%s reports an unknown user rather than silently doing nothing",
    async (_name, call) => {
      await expect(
        call("00000000-0000-4000-8000-000000000000"),
      ).rejects.toThrow(AppError);
    },
  );
});

describe("team membership", () => {
  beforeEach(async () => {
    await addTeam("platform", "Platform");
    await addTeam("support", "Support");
    await createUser({ email: "a@example.com", displayName: "Alice" });
  });

  it("adds, promotes and removes a member", async () => {
    await setTeamMember("platform", "a@example.com", "member");
    expect((await listTeamMembers("platform"))[0].team_role).toBe("member");

    await setTeamMember("platform", "a@example.com", "admin");
    expect(await listTeamMembers("platform")).toHaveLength(1);
    expect((await listTeamMembers("platform"))[0].team_role).toBe("admin");

    await setTeamMember("platform", "a@example.com", null);
    expect(await listTeamMembers("platform")).toEqual([]);
  });

  it("names the team or the user it could not find", async () => {
    await expect(
      setTeamMember("no-such-team", "a@example.com", "member"),
    ).rejects.toThrow(/no-such-team/);
    await expect(
      setTeamMember("platform", "nobody@example.com", "member"),
    ).rejects.toThrow(/nobody@example.com/);
  });

  it("lists a user's teams by slug", async () => {
    const user = await getUserByEmail("a@example.com");
    await setTeamMember("support", "a@example.com", "member");
    await setTeamMember("platform", "a@example.com", "admin");
    expect((await userTeams(user!.id)).map((t) => t.team_slug)).toEqual([
      "platform",
      "support",
    ]);
  });

  /**
   * The rung scoped credentials and preferences resolve through. Ambiguous
   * membership has to be null, not a pick: guessing would resolve one team's
   * credential for a user who belongs to two.
   */
  it("gives a sole team, and null for none or several", async () => {
    const user = await getUserByEmail("a@example.com");
    expect(await userSoleTeamId(user!.id)).toBeNull();

    await setTeamMember("platform", "a@example.com", "member");
    const [team] = await sql`select id from teams where slug = 'platform'`;
    expect(await userSoleTeamId(user!.id)).toBe(team.id);

    await setTeamMember("support", "a@example.com", "member");
    expect(await userSoleTeamId(user!.id)).toBeNull();
  });

  it("lists every membership at once for the access table", async () => {
    await createUser({ email: "b@example.com" });
    await setTeamMember("platform", "a@example.com", "admin");
    await setTeamMember("support", "b@example.com", "member");

    const all = await listMemberships();
    expect(all).toHaveLength(2);
    expect(all.map((m) => m.team_slug).sort()).toEqual(["platform", "support"]);
    expect(all.every((m) => m.team_name && m.user_id)).toBe(true);
  });

  it("lists members with their display names, by email", async () => {
    await createUser({ email: "b@example.com", displayName: "Bob" });
    await setTeamMember("platform", "b@example.com", "member");
    await setTeamMember("platform", "a@example.com", "member");
    const members = await listTeamMembers("platform");
    expect(members.map((m) => m.email)).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
    expect(members.map((m) => m.display_name)).toEqual(["Alice", "Bob"]);
  });
});

describe("analysis runs", () => {
  it("records a run with token accounting", async () => {
    const run = await recordRun({
      mode: "consult",
      model: "claude-sonnet-4-6",
      inputTokens: 1200,
      outputTokens: 300,
    });
    const [row] =
      await sql`select mode, input_tokens, output_tokens from analysis_runs where id = ${run.id}`;
    expect(row.mode).toBe("consult");
    expect(row.input_tokens).toBe(1200);
    expect(row.output_tokens).toBe(300);
  });

  /** The cost is derived once, at write time, so a later price change cannot
   *  silently rewrite what a past turn is recorded as having cost. */
  it("stamps an estimated cost into meta for a priced model", async () => {
    const run = await recordRun({
      mode: "consult",
      model: "claude-sonnet-5",
      inputTokens: 1_000_000,
      outputTokens: 100_000,
    });
    const [row] =
      await sql`select meta from analysis_runs where id = ${run.id}`;
    expect(row.meta.estimated_cost_usd).toBeGreaterThan(0);
  });

  it("leaves cost out for a model it has no price for", async () => {
    const run = await recordRun({
      mode: "ingest",
      model: "some-local-model",
      inputTokens: 10,
      outputTokens: 10,
    });
    const [row] =
      await sql`select meta from analysis_runs where id = ${run.id}`;
    expect(row.meta.estimated_cost_usd).toBeUndefined();
  });

  it("records a bare run with no model or tokens", async () => {
    const run = await recordRun({ mode: "sync" });
    const [row] =
      await sql`select mode, model, input_tokens from analysis_runs where id = ${run.id}`;
    expect(row.mode).toBe("sync");
    expect(row.model).toBeNull();
    expect(row.input_tokens).toBeNull();
  });

  it("keeps the caller's own meta beside the derived cost", async () => {
    const run = await recordRun({
      mode: "sync",
      model: "claude-sonnet-5",
      inputTokens: 1000,
      outputTokens: 100,
      meta: { source: "freshdesk", total: 12 },
    });
    const [row] =
      await sql`select meta from analysis_runs where id = ${run.id}`;
    expect(row.meta.source).toBe("freshdesk");
    expect(row.meta.total).toBe(12);
  });
});
