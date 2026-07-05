import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  listUsers, createUser, setUserRole, setUserPassword, setUserDisabled,
  listTeamMembers, setTeamMember, USER_ROLES, MIN_PASSWORD_LENGTH,
} from "@tachy/core";
import { requireAdmin } from "../auth";

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
  // null removes the membership
  role: z.string().min(1).nullable(),
});

// User management — everything here is admin-only (emails, roles, passwords).
export const users = new Hono()
  .use("*", requireAdmin)

  .get("/", async (c) => c.json(await listUsers()))

  .post("/", zValidator("json", createSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createUser({
      email: body.email,
      displayName: body.display_name,
      password: body.password,
      role: body.role,
    }));
  })

  .patch("/:id", zValidator("json", patchSchema), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    if (body.role !== undefined) await setUserRole(id, body.role);
    if (body.password !== undefined) await setUserPassword(id, body.password);
    if (body.disabled !== undefined) await setUserDisabled(id, body.disabled);
    return c.json({ ok: true });
  })

  .get("/team-members/:teamSlug", async (c) => c.json(await listTeamMembers(c.req.param("teamSlug"))))

  .put("/team-members/:teamSlug", zValidator("json", memberSchema), async (c) => {
    const { email, role } = c.req.valid("json");
    await setTeamMember(c.req.param("teamSlug"), email, role);
    return c.json({ ok: true });
  });
