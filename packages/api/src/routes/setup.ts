import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  sql, hashPassword, countAdmins, setSetting, addTeam, addProduct,
  AGENT_EFFORTS, DEPLOYMENT_PROFILES, MIN_PASSWORD_LENGTH, conflict,
} from "@tachy/core";
import { setSessionCookie, markBootstrapped } from "../auth";

const slugName = z.object({ slug: z.string().min(1), name: z.string().min(1) });

const setupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH),
  display_name: z.string().optional(),
  org_name: z.string().optional(),
  team: slugName.optional(),
  product: slugName.optional(), // requires team (kept for older clients)
  products: z.array(slugName).optional(), // requires team; the wizard's multi-product form
  settings: z
    .object({
      redaction_global: z.boolean().optional(),
      agent_model: z.string().min(1).optional(),
      agent_effort: z.enum(AGENT_EFFORTS).optional(),
      allowed_models: z.array(z.string().min(1)).optional(),
      deployment_profile: z.enum(DEPLOYMENT_PROFILES).optional(),
    })
    .optional(),
});

// First-run bootstrap. Mounted BEFORE the auth gate (public): the status probe
// drives the SPA wizard, and the POST is only usable while no admin exists.
export const setup = new Hono()
  .get("/status", async (c) => c.json({ bootstrapped: (await countAdmins()) > 0 }))

  .post("/", zValidator("json", setupSchema), async (c) => {
    const body = c.req.valid("json");
    const hash = await hashPassword(body.password);

    // Exclusive lock so two concurrent first-run POSTs can't both become admin.
    await sql.begin(async (tx) => {
      await tx`lock table users in exclusive mode`;
      const [row] = await tx`select count(*)::int as n from users where role = 'admin' and not disabled`;
      if ((row.n as number) > 0) throw conflict("already set up — log in as an admin instead");
      await tx`
        insert into users (email, display_name, role, password_hash)
        values (${body.email}, ${body.display_name ?? null}, 'admin', ${hash})
        on conflict (email) do update set
          display_name = coalesce(excluded.display_name, users.display_name),
          role = 'admin', password_hash = excluded.password_hash
      `;
    });
    markBootstrapped();

    if (body.org_name) await setSetting("org_name", body.org_name);
    for (const [key, value] of Object.entries(body.settings ?? {}))
      if (value !== undefined) await setSetting(key, value);

    if (body.team) {
      await addTeam(body.team.slug, body.team.name);
      if (body.product) await addProduct(body.team.slug, body.product.slug, body.product.name);
      for (const p of body.products ?? []) await addProduct(body.team.slug, p.slug, p.name);
    }

    await setSessionCookie(c, body.email);
    return c.json({ ok: true, email: body.email, role: "admin" });
  });
