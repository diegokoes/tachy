import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { secretsEnabled } from "@tachy/core/infra";
import {
  listCredentials,
  setCredential,
  deleteCredential,
  credentialSource,
  resolveAgentAuth,
  effectivePrefs,
  effectiveSettings,
  setPref,
  deletePref,
  sourceCredentialName,
} from "@tachy/core/config";
import { userSoleTeamId } from "@tachy/core/access";
import { listSourceConnections } from "@tachy/core/sources";
import {
  ANTHROPIC_API_KEY_CREDENTIAL,
  AGENT_EFFORTS,
  ANTHROPIC_OAUTH_CREDENTIAL,
} from "@tachy/core";
import {
  listNotifications,
  markRead,
  markSeen,
} from "@tachy/core/notifications";
import { listModels, type ModelChoice } from "@tachy/agent";
import { requireCaller } from "../authz";
import { userConfigDir } from "../turn-config";

const valueSchema = z.object({ value: z.string().min(1) });
const prefSchema = z.object({ value: z.unknown() });

/** Agent-credential names plus one source-token name per connection. */
async function knownCredentialNames(): Promise<string[]> {
  const connections = await listSourceConnections();
  return [
    ANTHROPIC_API_KEY_CREDENTIAL,
    ANTHROPIC_OAUTH_CREDENTIAL,
    ...connections.map((s) => sourceCredentialName(s.source_type, s.slug)),
  ];
}

export const me = new Hono()

  .get("/credentials", async (c) => {
    const userId = await requireCaller(c);
    const teamId = (await userSoleTeamId(userId)) ?? undefined;
    const names = await knownCredentialNames();
    const effective: Record<string, string | null> = {};
    for (const name of names)
      effective[name] =
        (await credentialSource(name, { userId, teamId })) ?? null;

    // Which credential a chat turn would actually pick, so a user with both an
    // API key and a subscription token can see which one is answering.
    const auth = await resolveAgentAuth({ userId, teamId });
    const inUse =
      auth &&
      {
        anthropic_api_key: ANTHROPIC_API_KEY_CREDENTIAL,
        anthropic_oauth: ANTHROPIC_OAUTH_CREDENTIAL,
      }[auth.kind];

    return c.json({
      vault_enabled: secretsEnabled(),
      mine: secretsEnabled() ? await listCredentials("user", userId) : [],
      effective,
      agent: {
        in_use: inUse ?? null,
        source: auth?.source ?? null,
      },
    });
  })

  .put("/credentials/:name", zValidator("json", valueSchema), async (c) => {
    const userId = await requireCaller(c);
    const name = c.req.param("name");
    const { value } = c.req.valid("json");
    await setCredential(userId, "user", userId, name, value);
    return c.json({ ok: true });
  })

  .delete("/credentials/:name", async (c) => {
    const userId = await requireCaller(c);
    const deleted = await deleteCredential(
      userId,
      "user",
      userId,
      c.req.param("name"),
    );
    return c.json({ ok: true, deleted });
  })

  .get("/preferences", async (c) => {
    const userId = await requireCaller(c);
    const teamId = (await userSoleTeamId(userId)) ?? undefined;
    return c.json(await effectivePrefs({ userId, teamId }));
  })

  /**
   * The models the caller's runtime offers under their own credential, held
   * to the org's allow-list. A runtime that cannot be asked still gets the
   * allow-list back, and an empty list tells the SPA to take a typed id.
   */
  .get("/models", async (c) => {
    const userId = await requireCaller(c);
    const teamId = (await userSoleTeamId(userId)) ?? undefined;
    const ctx = { userId, teamId };
    const settings = await effectiveSettings();
    const allowed = settings.allowed_models.value;

    let models: ModelChoice[] = [];
    let error: string | null = null;
    try {
      const agentAuth = await resolveAgentAuth(ctx);
      models = await listModels({
        ...(agentAuth ? { agentAuth } : {}),
        configDir: await userConfigDir(userId),
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    if (allowed.length) {
      const offered = new Map(models.map((m) => [m.id, m]));
      models = allowed.map(
        (id) =>
          offered.get(id) ?? { id, label: id, efforts: [...AGENT_EFFORTS] },
      );
    }
    return c.json({ models, restricted: allowed.length > 0, error });
  })

  .put("/preferences/:key", zValidator("json", prefSchema), async (c) => {
    const userId = await requireCaller(c);
    await setPref(
      userId,
      "user",
      userId,
      c.req.param("key"),
      c.req.valid("json").value,
    );
    return c.json({ ok: true });
  })

  .delete("/preferences/:key", async (c) => {
    const userId = await requireCaller(c);
    const deleted = await deletePref(
      userId,
      "user",
      userId,
      c.req.param("key"),
    );
    return c.json({ ok: true, deleted });
  })

  .get("/notifications", async (c) => {
    const userId = await requireCaller(c);
    return c.json(await listNotifications(userId));
  })

  .post("/notifications/seen", async (c) => {
    const userId = await requireCaller(c);
    await markSeen(userId);
    return c.json({ ok: true });
  })

  .post(
    "/notifications/read",
    zValidator("json", z.object({ ids: z.array(z.string().uuid()).min(1) })),
    async (c) => {
      const userId = await requireCaller(c);
      await markRead(userId, c.req.valid("json").ids);
      return c.json({ ok: true });
    },
  );
