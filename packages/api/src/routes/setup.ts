import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  sql,
  conflict,
  forbidden,
  env,
  secretsEnabled,
} from "@tachy/core/infra";
import {
  hashPassword,
  adminCount,
  getUserByEmail,
  upsertUser,
} from "@tachy/core/access";
import { recordAudit } from "@tachy/core/audit";
import { setSetting, setCredential } from "@tachy/core/config";
import { addTeam, addProduct } from "@tachy/core/catalog";
import {
  AGENT_EFFORTS,
  ANTHROPIC_API_KEY_CREDENTIAL,
  DEPLOYMENT_PROFILES,
  MIN_PASSWORD_LENGTH,
  ANTHROPIC_OAUTH_CREDENTIAL,
  OAUTH_PREFIX,
} from "@tachy/core";
import { setSessionCookie, markBootstrapped, sessionEmail } from "../auth";
import { callerAddress } from "../throttle";

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
    c.json({ bootstrapped: (await adminCount()) > 0 }),
  )

  .post("/", zValidator("json", setupSchema), async (c) => {
    const body = c.req.valid("json");
    const hash = await hashPassword(body.password);

    // Outside the `/api/*` guard the admin count alone gates this, and under
    // SSO it never rises: `upsertUser` provisions members. Where SSO can name
    // the caller it has to, and the wizard promotes that person.
    let verified: string | undefined;
    if (env.oidc) {
      verified = await sessionEmail(c);
      if (!verified)
        throw forbidden("SSO deployment: sign in first, then run setup");
      if (verified.toLowerCase() !== body.email.toLowerCase())
        throw forbidden(
          `signed in as ${verified}; setup only promotes the signed-in account`,
        );
    }

    await sql.begin(async (tx) => {
      await tx`lock table users in exclusive mode`;
      const [row] =
        await tx`select count(*)::int as n from users where role = 'admin' and not disabled`;
      if ((row.n as number) > 0)
        throw conflict("already set up; log in as an admin");

      // Taking over an existing row resets its password and returns a session
      // as its owner, which needs proof the caller is that person. Only SSO
      // gives it; otherwise the wizard only creates a new account.
      const [existing] =
        await tx`select id from users where email = ${body.email}`;
      if (existing && !verified)
        throw conflict(
          `an account for ${body.email} already exists; sign in with it`,
        );

      await tx`
        insert into users (email, display_name, role, password_hash)
        values (${body.email}, ${body.display_name ?? null}, 'admin', ${hash})
        on conflict (email) do update set
          display_name = coalesce(excluded.display_name, users.display_name),
          role = 'admin', password_hash = excluded.password_hash,
          session_epoch = users.session_epoch + 1
      `;
    });
    markBootstrapped();

    if (body.org_name) await setSetting("org_name", body.org_name);
    for (const [key, value] of Object.entries(body.settings ?? {}))
      if (value !== undefined) await setSetting(key, value);

    if (body.agent_key && secretsEnabled()) {
      const admin = await getUserByEmail(body.email);
      if (admin) {
        const name = body.agent_key.startsWith(OAUTH_PREFIX)
          ? ANTHROPIC_OAUTH_CREDENTIAL
          : ANTHROPIC_API_KEY_CREDENTIAL;
        // The wizard's key is the first admin's own, not the deployment's:
        // every other user brings theirs under Settings > keys.
        await setCredential(admin.id, "user", admin.id, name, body.agent_key);
      }
    }

    if (body.team) {
      await addTeam(body.team.slug, body.team.name);
      if (body.product)
        await addProduct(body.team.slug, body.product.slug, body.product.name);
      for (const product of body.products ?? [])
        await addProduct(body.team.slug, product.slug, product.name);
    }

    await recordAudit({
      actor: { userId: await upsertUser(body.email), actor: "web" },
      action: "setup",
      target: body.email,
      address: callerAddress(c),
    });
    await setSessionCookie(c, body.email);
    return c.json({ ok: true, email: body.email, role: "admin" });
  });
