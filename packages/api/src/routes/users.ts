import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  listUsers,
  createUser,
  setUserRole,
  setUserPassword,
  setUserDisabled,
  setUserFlags,
  setUserDisplayName,
  listTeamMembers,
  listMemberships,
  setTeamMember,
  userEmailOf,
  listApiTokens,
  mintApiToken,
  tokenExpiry,
  revokeApiToken,
} from "@tachy/core/access";
import { notFound } from "@tachy/core/infra";
import { USER_ROLES, TEAM_ROLES, MIN_PASSWORD_LENGTH } from "@tachy/core";
import { requireAdmin, requireSession } from "../auth";
import { tokenSchema } from "../tokens";
import { audit } from "../audit";
import { assertTeamAdmin, callerUserId, isAnyTeamAdminApi } from "../authz";

const createSchema = z.object({
  email: z.string().email(),
  display_name: z.string().optional(),
  password: z.string().min(MIN_PASSWORD_LENGTH).optional(),
  role: z.enum(USER_ROLES).optional(),
  service_account: z.boolean().optional(),
  password_login_allowed: z.boolean().optional(),
});

const patchSchema = z.object({
  display_name: z.string().nullable().optional(),
  role: z.enum(USER_ROLES).optional(),
  password: z.string().min(MIN_PASSWORD_LENGTH).optional(),
  disabled: z.boolean().optional(),
  service_account: z.boolean().optional(),
  password_login_allowed: z.boolean().optional(),
});

const memberSchema = z.object({
  email: z.string().email(),

  role: z.enum(TEAM_ROLES).nullable(),
});

/**
 * Anyone signed in reads the directory and the rosters. How each account signs
 * in goes only to those who curate a team or the app.
 */
export const users = new Hono()
  .get("/", async (c) => {
    const rows = await listUsers();
    if (await isAnyTeamAdminApi(c)) return c.json(rows);
    return c.json(
      rows.map(
        ({ has_password, service_account, password_login_allowed, ...row }) =>
          row,
      ),
    );
  })

  .post("/", requireAdmin, zValidator("json", createSchema), async (c) => {
    const body = c.req.valid("json");
    const created = await createUser({
      email: body.email,
      displayName: body.display_name,
      password: body.password,
      role: body.role,
      serviceAccount: body.service_account,
      passwordLoginAllowed: body.password_login_allowed,
    });
    await audit(c, "user_create", created.email, {
      role: created.role,
      with_password: created.has_password,
      service_account: created.service_account,
    });
    return c.json(created);
  })

  .patch("/:id", requireAdmin, zValidator("json", patchSchema), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    if (body.display_name !== undefined)
      await setUserDisplayName(id, body.display_name || null);
    if (body.role !== undefined) await setUserRole(id, body.role);
    if (body.password !== undefined) await setUserPassword(id, body.password);
    if (body.disabled !== undefined) await setUserDisabled(id, body.disabled);
    await setUserFlags(id, {
      serviceAccount: body.service_account,
      passwordLoginAllowed: body.password_login_allowed,
    });
    const { password, ...named } = body;
    await audit(c, "user_update", await userEmailOf(id), {
      ...named,
      ...(password === undefined ? {} : { password: "changed" }),
    });
    return c.json({ ok: true });
  })

  // An admin mints for someone else here, which is how a service account that
  // cannot sign in gets its token.
  .get("/:id/tokens", requireAdmin, async (c) =>
    c.json(await listApiTokens(c.req.param("id")!)),
  )

  .post(
    "/:id/tokens",
    requireAdmin,
    requireSession,
    zValidator("json", tokenSchema),
    async (c) => {
      const owner = await userEmailOf(c.req.param("id")!);
      if (!owner) throw notFound("no such user");
      const body = c.req.valid("json");
      const { token, row } = await mintApiToken({
        userId: c.req.param("id")!,
        name: body.name,
        expiresAt: tokenExpiry(body.expires_in_days),
        createdBy: await callerUserId(c),
      });
      await audit(c, "api_token_mint", body.name, {
        for: owner,
        expires_at: row.expires_at,
      });
      return c.json({ ...row, token }, 201);
    },
  )

  .delete("/:id/tokens/:tokenId", requireAdmin, async (c) => {
    const row = await revokeApiToken(
      c.req.param("tokenId")!,
      c.req.param("id")!,
    );
    await audit(c, "api_token_revoke", row.name, {
      for: await userEmailOf(c.req.param("id")!),
    });
    return c.json(row);
  })

  .get("/memberships", async (c) => c.json(await listMemberships()))

  .get("/team-members/:teamSlug", async (c) =>
    c.json(await listTeamMembers(c.req.param("teamSlug"))),
  )

  .put(
    "/team-members/:teamSlug",
    zValidator("json", memberSchema),
    async (c) => {
      await assertTeamAdmin(c, c.req.param("teamSlug"));
      const { email, role } = c.req.valid("json");
      await setTeamMember(c.req.param("teamSlug"), email, role);
      await audit(c, "team_member_set", email, {
        team: c.req.param("teamSlug"),
        role,
      });
      return c.json({ ok: true });
    },
  );
