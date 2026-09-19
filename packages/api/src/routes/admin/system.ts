import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  log,
  env,
  effectiveSettings,
  setSetting,
  secretsEnabled,
  credentialSource,
  AGENT_CREDENTIALS,
  envCredential,
} from "@tachy/core";
import { requireAdmin } from "../../auth";
import { isAdminIdentity } from "../../authz";
import { runtimeSnapshot } from "../../runtime";
import { lifecycle } from "../../lifecycle";

/** Deployment settings and the maintenance switch. */
export const system = new Hono()
  /*
   * Members read this: the settings and the global-credential availability are
   * what the app renders its own chrome from. The `env` block is different —
   * which secrets are configured, where uploads land, what the API port is — and
   * only Admin > System renders it, so it travels only to an admin. `upload_dir`
   * in particular is a path the ingest tools read from.
   */
  .get("/system", async (c) =>
    c.json({
      settings: await effectiveSettings(),
      credentials: {
        vault_enabled: secretsEnabled(),
        // Global-scope availability (source: global | env | null) — the
        // per-user view lives under /me/credentials.
        anthropic_api_key:
          (await credentialSource(AGENT_CREDENTIALS.claude, {})) ?? null,
        copilot_token:
          (await credentialSource(AGENT_CREDENTIALS.copilot, {})) ?? null,
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
                envCredential(AGENT_CREDENTIALS.claude),
              ),
              copilot_token_set: Boolean(
                envCredential(AGENT_CREDENTIALS.copilot),
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
