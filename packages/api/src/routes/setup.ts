import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  sql,
  hashPassword,
  countAdmins,
  setSetting,
  addTeam,
  addProduct,
  AGENT_EFFORTS,
  AGENT_CREDENTIALS,
  AGENT_PROVIDERS,
  DEPLOYMENT_PROFILES,
  MIN_PASSWORD_LENGTH,
  conflict,
  forbidden,
  env,
  secretsEnabled,
  ANTHROPIC_OAUTH_CREDENTIAL,
  OAUTH_PREFIX,
  setCredential,
  getUserByEmail,
} from "@tachy/core";
import { setSessionCookie, markBootstrapped, sessionEmail } from "../auth";

const slugName = z.object({ slug: z.string().min(1), name: z.string().min(1) });

const setupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH),
  display_name: z.string().optional(),
  org_name: z.string().optional(),
  team: slugName.optional(),
  product: slugName.optional(),
  products: z.array(slugName).optional(),
  settings: z
    .object({
      redaction_global: z.boolean().optional(),
      agent_provider: z.enum(AGENT_PROVIDERS).optional(),
      agent_model: z.string().min(1).optional(),
      agent_effort: z.enum(AGENT_EFFORTS).optional(),
      allowed_models: z.array(z.string().min(1)).optional(),
      deployment_profile: z.enum(DEPLOYMENT_PROFILES).optional(),
    })
    .optional(),
  agent_key: z.string().min(1).optional(),
});

export const setup = new Hono()
  .get("/status", async (c) =>
    c.json({ bootstrapped: (await countAdmins()) > 0 }),
  )

  .post("/", zValidator("json", setupSchema), async (c) => {
    const body = c.req.valid("json");
    const hash = await hashPassword(body.password);

    /*
     * This route sits outside the `/api/*` identity guard — on a fresh install
     * there is nobody to authenticate yet. The admin count is therefore the only
     * thing standing between a stranger and an admin account, and on an SSO
     * deployment it never rises: `upsertUser` provisions members, so nothing
     * closes the door. Hence the second gate: where SSO can say who is calling,
     * it has to, and the wizard promotes that person rather than anyone who
     * asks.
     */
    let verified: string | undefined;
    if (env.oidc) {
      verified = await sessionEmail(c);
      if (!verified)
        throw forbidden(
          "this deployment uses SSO — sign in first, then run setup",
        );
      if (verified.toLowerCase() !== body.email.toLowerCase())
        throw forbidden(
          `signed in as ${verified} — setup can only promote the account you are signed in as`,
        );
    }

    await sql.begin(async (tx) => {
      await tx`lock table users in exclusive mode`;
      const [row] =
        await tx`select count(*)::int as n from users where role = 'admin' and not disabled`;
      if ((row.n as number) > 0)
        throw conflict("already set up — log in as an admin instead");

      /*
       * Taking over an existing row means resetting its password and handing
       * back a session as its owner, so it needs proof the caller is that
       * person. SSO is the only thing that can give that proof here; without it
       * the wizard may only create an account nobody was using.
       */
      const [existing] =
        await tx`select id from users where email = ${body.email}`;
      if (existing && !verified)
        throw conflict(
          `an account for ${body.email} already exists — sign in with it instead`,
        );

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

    if (body.agent_key && secretsEnabled()) {
      const admin = await getUserByEmail(body.email);
      if (admin) {
        const provider = body.settings?.agent_provider ?? "claude";
        const name =
          provider === "claude" && body.agent_key.startsWith(OAUTH_PREFIX)
            ? ANTHROPIC_OAUTH_CREDENTIAL
            : AGENT_CREDENTIALS[provider];
        await setCredential(
          admin.id,
          "global",
          undefined,
          name,
          body.agent_key,
        );
      }
    }

    if (body.team) {
      await addTeam(body.team.slug, body.team.name);
      if (body.product)
        await addProduct(body.team.slug, body.product.slug, body.product.name);
      for (const p of body.products ?? [])
        await addProduct(body.team.slug, p.slug, p.name);
    }

    await setSessionCookie(c, body.email);
    return c.json({ ok: true, email: body.email, role: "admin" });
  });
