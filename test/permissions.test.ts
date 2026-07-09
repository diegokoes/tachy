import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../packages/api/src/app";
import {
  createUser, setTeamMember, addTeam, addProduct, saveKnowledgeEntry,
  canEditScope, canManageTeamBySlug, isAnyTeamAdmin, teamAdminTeams,
  assertCanEditScope, assertGlobalAdmin, clearPermissionCache, AppError,
} from "@tachy/core";
import { resetData, sql, tpdProductId } from "./helpers";

afterAll(() => sql.end());



describe("core permissions", () => {
  let globalAdmin: string;
  let teamAdmin: string;
  let member: string;
  let testTeamId: string;
  let otherTeamId: string;
  let otherProductId: string;

  beforeAll(async () => {
    await resetData();
    globalAdmin = (await createUser({ email: "root@example.com", role: "admin" })).id;
    teamAdmin = (await createUser({ email: "lead@example.com", role: "member" })).id;
    member = (await createUser({ email: "dev@example.com", role: "member" })).id;
    await setTeamMember("test-team", "lead@example.com", "admin");
    await setTeamMember("test-team", "dev@example.com", "member");

    const other = await addTeam("other-team", "Other Team");
    otherTeamId = other.id;
    const prod = await addProduct("other-team", "op", "Other Product");
    otherProductId = prod.id;
    const [tt] = await sql`select id from teams where slug = 'test-team'`;
    testTeamId = tt.id as string;
  });

  beforeEach(() => clearPermissionCache());

  it("global admin can edit any scope, including org-global", async () => {
    expect(await canEditScope(globalAdmin, {})).toBe(true);
    expect(await canEditScope(globalAdmin, { teamId: otherTeamId })).toBe(true);
    expect(await canEditScope(globalAdmin, { productId: otherProductId })).toBe(true);
    await expect(assertGlobalAdmin(globalAdmin)).resolves.toBeUndefined();
  });

  it("team admin edits own team by teamId and by owned product", async () => {
    expect(await canEditScope(teamAdmin, { teamId: testTeamId })).toBe(true);
    expect(await canEditScope(teamAdmin, { productId: await tpdProductId() })).toBe(true);
  });

  it("team admin is denied cross-team and org-global scopes", async () => {
    expect(await canEditScope(teamAdmin, { teamId: otherTeamId })).toBe(false);
    expect(await canEditScope(teamAdmin, { productId: otherProductId })).toBe(false);
    expect(await canEditScope(teamAdmin, {})).toBe(false);
    await expect(assertGlobalAdmin(teamAdmin)).rejects.toThrow(AppError);
  });

  it("plain member is denied everywhere", async () => {
    expect(await canEditScope(member, { teamId: testTeamId })).toBe(false);
    expect(await isAnyTeamAdmin(member)).toBe(false);
    await expect(assertCanEditScope(member, { teamId: testTeamId })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("team management and team-admin listing", async () => {
    expect(await canManageTeamBySlug(teamAdmin, "test-team")).toBe(true);
    expect(await canManageTeamBySlug(teamAdmin, "other-team")).toBe(false);
    expect(await canManageTeamBySlug(globalAdmin, "other-team")).toBe(true);
    expect(await teamAdminTeams(teamAdmin)).toEqual([
      { team_id: testTeamId, team_slug: "test-team" },
    ]);
  });

  it("disabled users lose all rights (after cache clear)", async () => {
    await sql`update users set disabled = true where id = ${teamAdmin}`;
    clearPermissionCache();
    expect(await canEditScope(teamAdmin, { teamId: testTeamId })).toBe(false);
    await sql`update users set disabled = false where id = ${teamAdmin}`;
    clearPermissionCache();
  });

  it("rejects a team role outside the vocabulary at the DB", async () => {
    await expect(
      sql`insert into team_members (team_id, user_id, role) values (${otherTeamId}, ${member}, 'lead')`,
    ).rejects.toThrow(/team_members_role_check/);
  });
});

describe("API enforcement (team mini-admin vs member vs admin)", () => {
  const app = createApp({ passwordAuth: true });
  const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";
  let adminCookie: string;
  let leadCookie: string; 
  let devCookie: string; 
  let ownEntryId: string; 
  let otherEntryId: string; 

  const login = async (email: string, password: string) => {
    const res = await app.request("/auth/password/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      headers: { "Content-Type": "application/json" },
    });
    return cookieOf(res);
  };
  const req = (cookie: string, path: string, method: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "Content-Type": "application/json", cookie },
    });

  beforeAll(async () => {
    await resetData();
    clearPermissionCache();
    await createUser({ email: "boss@example.com", password: "admin-password", role: "admin" });
    await createUser({ email: "lead@example.com", password: "lead-password", role: "member" });
    await createUser({ email: "dev@example.com", password: "dev-password", role: "member" });
    await setTeamMember("test-team", "lead@example.com", "admin");
    await setTeamMember("test-team", "dev@example.com", "member");
    const other = await addTeam("other-team", "Other Team");

    ownEntryId = (await saveKnowledgeEntry({
      productId: await tpdProductId(),
      issueSummary: "own-team entry",
      status: "approved",
    })).id;
    otherEntryId = (await saveKnowledgeEntry({
      teamId: other.id as string,
      issueSummary: "other-team entry",
      status: "approved",
    })).id;

    adminCookie = await login("boss@example.com", "admin-password");
    leadCookie = await login("lead@example.com", "lead-password");
    devCookie = await login("dev@example.com", "dev-password");
  });

  beforeEach(() => clearPermissionCache());

  it("team admin can PATCH an own-team entry but not a cross-team one", async () => {
    const ok = await req(leadCookie, `/knowledge/${ownEntryId}`, "PATCH", { rootCause: "found it" });
    expect(ok.status).toBe(200);
    const denied = await req(leadCookie, `/knowledge/${otherEntryId}`, "PATCH", { rootCause: "nope" });
    expect(denied.status).toBe(403);
  });

  it("plain member cannot PATCH or POST knowledge", async () => {
    const patch = await req(devCookie, `/knowledge/${ownEntryId}`, "PATCH", { rootCause: "x" });
    expect(patch.status).toBe(403);
    const post = await req(devCookie, "/knowledge", "POST", { issueSummary: "y" });
    expect(post.status).toBe(403);
  });

  it("team admin creates entries and products in their team, not org-wide", async () => {
    const entry = await req(leadCookie, "/knowledge", "POST", {
      productId: await tpdProductId(),
      issueSummary: "lead-created",
    });
    expect(entry.status).toBe(200);
    const product = await req(leadCookie, "/products", "POST", {
      team_slug: "test-team", slug: "newp", name: "New Product",
    });
    expect(product.status).toBe(200);
    const crossProduct = await req(leadCookie, "/products", "POST", {
      team_slug: "other-team", slug: "nope", name: "Nope",
    });
    expect(crossProduct.status).toBe(403);
  });

  it("org-wide ops stay global-admin-only for team admins", async () => {
    expect((await req(leadCookie, "/teams", "POST", { slug: "t2", name: "T2" })).status).toBe(403);
    expect((await req(leadCookie, "/settings/agent_effort", "PUT", { value: "low" })).status).toBe(403);
    expect((await req(adminCookie, "/teams", "POST", { slug: "t2", name: "T2" })).status).toBe(200);
  });

  it("team membership is manageable by that team's admin only", async () => {
    const ok = await req(leadCookie, "/users/team-members/test-team", "PUT", {
      email: "dev@example.com", role: "member",
    });
    expect(ok.status).toBe(200);
    const denied = await req(leadCookie, "/users/team-members/other-team", "PUT", {
      email: "dev@example.com", role: "member",
    });
    expect(denied.status).toBe(403);
    const badRole = await req(leadCookie, "/users/team-members/test-team", "PUT", {
      email: "dev@example.com", role: "lead",
    });
    expect(badRole.status).toBe(400);
  });

  it("/auth/me carries the caller's team-admin set", async () => {
    const me = await app.request("/auth/me", { headers: { cookie: leadCookie } });
    const body = await me.json();
    expect(body.team_admin).toEqual([expect.objectContaining({ team_slug: "test-team" })]);
    const dev = await (await app.request("/auth/me", { headers: { cookie: devCookie } })).json();
    expect(dev.team_admin).toEqual([]);
  });

  it("attributes HTTP knowledge posts and feedback to the session user", async () => {
    const res = await req(leadCookie, "/knowledge", "POST", {
      productId: await tpdProductId(),
      issueSummary: "attributed entry",
    });
    expect(res.status).toBe(200);
    const { id } = await res.json();
    const [entry] = await sql`
      select u.email from knowledge_entries k join users u on u.id = k.created_by where k.id = ${id}
    `;
    expect(entry.email).toBe("lead@example.com");

    const fb = await req(devCookie, `/knowledge/${id}/feedback`, "POST", { rating: 4 });
    expect(fb.status).toBe(200);
    const [row] = await sql`
      select u.email from knowledge_feedback f join users u on u.id = f.user_id
      where f.knowledge_entry_id = ${id}
    `;
    expect(row.email).toBe("dev@example.com");
  });

  it("GET /knowledge narrows by component slug/alias within a product", async () => {
    const productId = await tpdProductId();
    const comp = await req(adminCookie, "/products/tpd/components", "POST", {
      slug: "line-controller", name: "Line Controller", aliases: ["lc"],
    });
    expect(comp.status).toBe(200);
    const inComp = await req(adminCookie, "/knowledge", "POST", {
      productId, issueSummary: "lc jam", component: "line-controller",
    });
    expect(inComp.status).toBe(200);
    const inCompId = (await inComp.json()).id as string;
    const outComp = await req(adminCookie, "/knowledge", "POST", {
      productId, issueSummary: "printer offline",
    });
    expect(outComp.status).toBe(200);

    
    const res = await app.request(`/api/knowledge?product_id=${productId}&component=lc`, {
      headers: { cookie: devCookie },
    });
    const rows = await res.json();
    expect(rows.map((r: { id: string }) => r.id)).toEqual([inCompId]);
  });

  it("reference docs: curator-gated create, status flips, stale version 409", async () => {
    const denied = await req(devCookie, "/reference", "POST", {
      title: "runbook", body: "restart the line controller after deploys",
      productId: await tpdProductId(),
    });
    expect(denied.status).toBe(403);

    const created = await req(leadCookie, "/reference", "POST", {
      title: "runbook", body: "restart the line controller after deploys",
      productId: await tpdProductId(), status: "draft",
    });
    expect(created.status).toBe(200);
    const doc = await created.json();
    const [attributed] = await sql`
      select u.email from reference_docs d join users u on u.id = d.created_by where d.id = ${doc.id}
    `;
    expect(attributed.email).toBe("lead@example.com");

    const approved = await req(leadCookie, `/reference/${doc.id}`, "PATCH", {
      status: "approved", expectedVersion: doc.version,
    });
    expect(approved.status).toBe(200);
    expect((await approved.json()).status).toBe("approved");

    const stale = await req(leadCookie, `/reference/${doc.id}`, "PATCH", {
      status: "archived", expectedVersion: doc.version, 
    });
    expect(stale.status).toBe(409);

    const crossTeam = await req(devCookie, `/reference/${doc.id}`, "PATCH", { status: "archived" });
    expect(crossTeam.status).toBe(403);
  });
});
