import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { log, env, secretsEnabled } from "@tachy/core/infra";
import {
  effectiveSettings,
  setSetting,
  credentialSource,
  envCredential,
} from "@tachy/core/config";
import { ANTHROPIC_API_KEY_CREDENTIAL } from "@tachy/core";
import { requireAdmin } from "../../auth";
import { isAdminIdentity } from "../../authz";
import { runtimeSnapshot } from "../../runtime";
import { lifecycle } from "../../lifecycle";

/** Deployment settings and the maintenance switch. */
export const system = new Hono()
  // Members read this: the app renders its chrome from the settings and from
  // whether the environment supplies a fallback agent key. The `env` block
  // (which secrets are configured, the API port) travels only to an admin.
  .get("/system", async (c) =>
    c.json({
      settings: await effectiveSettings(),
      credentials: {
        vault_enabled: secretsEnabled(),
        // No user here, so availability is the environment's fallback or null.
        // Each person's own keys are under /me/credentials.
        anthropic_api_key:
          (await credentialSource(ANTHROPIC_API_KEY_CREDENTIAL, {})) ?? null,
      },
      ...(isAdminIdentity(c)
        ? {
            env: {
              auth_mode: env.authMode,
              port: env.port,
              user_email: env.userEmail ?? null,
              oidc_configured: Boolean(env.oidc),
              api_token_set: Boolean(env.apiToken),
              session_secret_set: Boolean(env.sessionSecret),
              anthropic_api_key_set: Boolean(
                envCredential(ANTHROPIC_API_KEY_CREDENTIAL),
              ),
              env_badge: env.envBadge ?? null,
              commit: env.commit ?? null,
            },
            runtime: await runtimeSnapshot(),
          }
        : {}),
    }),
  )

  .post(
    "/system/maintenance",
    requireAdmin,
    zValidator("json", z.object({ refuse_chats: z.boolean() })),
    async (c) => {
      lifecycle.refusingChats = c.req.valid("json").refuse_chats;
      log("warn", "maintenance", { refuse_chats: lifecycle.refusingChats });
      return c.json({ refuse_chats: lifecycle.refusingChats });
    },
  )

  .put(
    "/settings/:key",
    requireAdmin,
    zValidator("json", z.object({ value: z.unknown() })),
    async (c) => {
      await setSetting(c.req.param("key")!, c.req.valid("json").value);
      return c.json({ settings: await effectiveSettings() });
    },
  );
