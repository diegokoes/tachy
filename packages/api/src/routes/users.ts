import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  listUsers,
  createUser,
  setUserRole,
  setUserPassword,
  setUserDisabled,
  listTeamMembers,
  setTeamMember,
  USER_ROLES,
  TEAM_ROLES,
  MIN_PASSWORD_LENGTH,
} from "@tachy/core";
import { requireAdmin } from "../auth";
import { assertAnyTeamAdminApi, assertTeamAdmin } from "../authz";

const createSchema = z.object({
  email: z.string().email(),
  display_name: z.string().optional(),
  password: z.string().min(MIN_PASSWORD_LENGTH).optional(),
  role: z.enum(USER_ROLES).optional(),
});

const patchSchema = z.object({
  role: z.enum(USER_ROLES).optional(),
  password: z.string().min(MIN_PASSWORD_LENGTH).optional(),
  disabled: z.boolean().optional(),
});

const memberSchema = z.object({
  email: z.string().email(),

  role: z.enum(TEAM_ROLES).nullable(),
});

export const users = new Hono()
  .get("/", async (c) => {
    await assertAnyTeamAdminApi(c);
    return c.json(await listUsers());
  })

  .post("/", requireAdmin, zValidator("json", createSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(
      await createUser({
        email: body.email,
        displayName: body.display_name,
        password: body.password,
        role: body.role,
      }),
    );
  })

  .patch("/:id", requireAdmin, zValidator("json", patchSchema), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    if (body.role !== undefined) await setUserRole(id, body.role);
    if (body.password !== undefined) await setUserPassword(id, body.password);
    if (body.disabled !== undefined) await setUserDisabled(id, body.disabled);
    return c.json({ ok: true });
  })

  .get("/team-members/:teamSlug", async (c) => {
    await assertTeamAdmin(c, c.req.param("teamSlug"));
    return c.json(await listTeamMembers(c.req.param("teamSlug")));
  })

  .put(
    "/team-members/:teamSlug",
    zValidator("json", memberSchema),
    async (c) => {
      await assertTeamAdmin(c, c.req.param("teamSlug"));
      const { email, role } = c.req.valid("json");
      await setTeamMember(c.req.param("teamSlug"), email, role);
      return c.json({ ok: true });
    },
  );
