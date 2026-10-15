import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  MCP_CREDENTIAL_MODES,
  MCP_TRANSPORTS,
  POOL_LABEL_RE,
  type McpServerRow,
} from "@tachy/core";
import { badInput, errorText, secretsEnabled } from "@tachy/core/infra";
import {
  allowedStdioCommands,
  deleteMcpServer,
  deletePoolToken,
  getMcpServer,
  listMcpServers,
  listPoolCredentials,
  listServerTools,
  ownToken,
  poolTokens,
  probeServer,
  refreshTools,
  saveMcpServer,
  serverTraffic,
  setPoolToken,
  setToolExposed,
} from "@tachy/core/mcp-servers";
import { validate } from "../../validation";
import { requireAdmin } from "../../auth";
import { audit } from "../../audit";
import { callerUserId, requireCaller } from "../../authz";

const stringRecord = z.record(z.string(), z.string());

const serverSchema = z.object({
  slug: z.string(),
  name: z.string().trim().min(1).max(200),
  transport: z.enum(MCP_TRANSPORTS),
  config: z.union([
    z.object({ url: z.string(), headers: stringRecord.optional() }),
    z.object({
      command: z.string(),
      args: z.array(z.string()).optional(),
      env: stringRecord.optional(),
      files: z
        .array(z.object({ path: z.string(), content: z.string() }))
        .optional(),
    }),
  ]),
  credentialMode: z.enum(MCP_CREDENTIAL_MODES),
  toolPrefix: z.string(),
  rateWindows: z
    .array(
      z.object({
        seconds: z.number().int().positive(),
        limit: z.number().int().positive(),
      }),
    )
    .optional(),
  rateLimitCodes: z.array(z.number().int()).optional(),
  argumentBindings: stringRecord.optional(),
  resultMaxChars: z.number().int().positive().max(1_000_000).optional(),
  callTimeoutMs: z.number().int().positive().max(600_000).optional(),
  redaction: z.boolean().optional(),
  enabled: z.boolean().optional(),
  note: z.string().max(2000).nullish(),
  teams: z.array(z.string()).optional(),
});

const exposeSchema = z.object({
  exposed: z.boolean(),
  attested: z.boolean().optional(),
});

const tokenSchema = z.object({ value: z.string().min(1) });

const labelParam = (c: Context) => {
  const label = c.req.param("label")!;
  if (!POOL_LABEL_RE.test(label)) throw badInput(`invalid label '${label}'`);
  return label;
};

/**
 * The token a console action connects with: the caller's own for a personal
 * server, a pool member for a shared one (`label`, or the first).
 */
async function consoleToken(c: Context, server: McpServerRow): Promise<string> {
  if (server.credential_mode === "personal") {
    const own = await ownToken(server.slug, await requireCaller(c));
    if (!own)
      throw badInput(
        `save your own token for '${server.slug}' under Settings › Keys first`,
      );
    return own.token;
  }
  const label = c.req.query("label");
  const pool = await poolTokens(server.slug);
  const credential = label
    ? pool.find((entry) => entry.key === `shared:${label}`)
    : pool[0];
  if (!credential)
    throw badInput(
      label
        ? `no pool token labelled '${label}'`
        : `add a token to '${server.slug}''s pool first`,
    );
  return credential.token;
}

/**
 * Linked MCP servers. Anyone signed in reads their settings and tools; app
 * admins change them, hold the pool and run the test and refresh calls.
 */
export const mcpServers = new Hono()
  .get("/mcp-servers", async (c) =>
    c.json({
      servers: await listMcpServers(),
      stdio_commands: allowedStdioCommands(),
      traffic: await serverTraffic(),
    }),
  )
  .get("/mcp-servers/:slug", async (c) =>
    c.json(await getMcpServer(c.req.param("slug")!)),
  )
  .post(
    "/mcp-servers",
    requireAdmin,
    validate("json", serverSchema),
    async (c) => {
      const body = c.req.valid("json");
      const saved = await saveMcpServer(body, await callerUserId(c));
      await audit(c, "mcp_server_save", body.slug, {
        transport: body.transport,
        credential_mode: body.credentialMode,
        teams: body.teams ?? null,
      });
      return c.json(saved);
    },
  )
  .delete("/mcp-servers/:slug", requireAdmin, async (c) => {
    const slug = c.req.param("slug")!;
    await deleteMcpServer(slug);
    await audit(c, "mcp_server_delete", slug);
    return c.json({ ok: true });
  })
  .post("/mcp-servers/:slug/test", requireAdmin, async (c) => {
    const server = await getMcpServer(c.req.param("slug")!);
    try {
      const probe = await probeServer(server, await consoleToken(c, server));
      return c.json({ ok: true, ...probe });
    } catch (e) {
      return c.json({ ok: false, error: errorText(e) });
    }
  })
  .post("/mcp-servers/:slug/refresh", requireAdmin, async (c) => {
    const server = await getMcpServer(c.req.param("slug")!);
    const outcome = await refreshTools(server, await consoleToken(c, server));
    return c.json(outcome);
  })
  .get("/mcp-servers/:slug/tools", async (c) =>
    c.json(await listServerTools(c.req.param("slug")!)),
  )
  .put(
    "/mcp-servers/:slug/tools/:name",
    requireAdmin,
    validate("json", exposeSchema),
    async (c) => {
      const slug = c.req.param("slug")!;
      const name = c.req.param("name")!;
      const body = c.req.valid("json");
      const tool = await setToolExposed(
        slug,
        name,
        body,
        await callerUserId(c),
      );
      await audit(c, "mcp_server_tool_expose", `${slug}:${name}`, {
        exposed: body.exposed,
        attested: body.attested ?? false,
      });
      return c.json(tool);
    },
  )
  .get("/mcp-servers/:slug/credentials", requireAdmin, async (c) =>
    c.json(await listPoolCredentials(await getMcpServer(c.req.param("slug")!))),
  )
  .put(
    "/mcp-servers/:slug/credentials/:label",
    requireAdmin,
    validate("json", tokenSchema),
    async (c) => {
      if (!secretsEnabled())
        throw badInput("credential storage disabled: set TACHY_SECRET_KEY");
      const server = await getMcpServer(c.req.param("slug")!);
      const label = labelParam(c);
      await setPoolToken(
        await requireCaller(c),
        server.slug,
        label,
        c.req.valid("json").value,
      );
      await audit(c, "mcp_server_credential_set", `${server.slug}:${label}`);
      return c.json({ ok: true });
    },
  )
  .delete("/mcp-servers/:slug/credentials/:label", requireAdmin, async (c) => {
    const slug = c.req.param("slug")!;
    const label = labelParam(c);
    const deleted = await deletePoolToken(await requireCaller(c), slug, label);
    await audit(c, "mcp_server_credential_delete", `${slug}:${label}`);
    return c.json({ deleted });
  });
