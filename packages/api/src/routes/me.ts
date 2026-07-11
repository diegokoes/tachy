import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  secretsEnabled,
  listCredentials,
  setCredential,
  deleteCredential,
  credentialSource,
  effectivePrefs,
  setPref,
  deletePref,
  userSoleTeamId,
  listSourceConnections,
  AGENT_CREDENTIALS,
  sourceCredentialName,
} from "@tachy/core";
import { requireCaller } from "../authz";

const valueSchema = z.object({ value: z.string().min(1) });
const prefSchema = z.object({ value: z.unknown() });

/** Agent-key names plus one source-token name per connection. */
async function knownCredentialNames(): Promise<string[]> {
  const connections = await listSourceConnections();
  return [
    ...Object.values(AGENT_CREDENTIALS),
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
    return c.json({
      vault_enabled: secretsEnabled(),
      mine: secretsEnabled() ? await listCredentials("user", userId) : [],
      effective,
    });
  })

  .put("/credentials/:name", zValidator("json", valueSchema), async (c) => {
    const userId = await requireCaller(c);
    await setCredential(
      userId,
      "user",
      userId,
      c.req.param("name"),
      c.req.valid("json").value,
    );
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
  });
