import "dotenv/config";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const oidcRaw =
  process.env.OIDC_ISSUER &&
  process.env.OIDC_CLIENT_ID &&
  process.env.OIDC_CLIENT_SECRET
    ? {
        issuer: process.env.OIDC_ISSUER,
        clientId: process.env.OIDC_CLIENT_ID,
        clientSecret: process.env.OIDC_CLIENT_SECRET,
        redirectUri: process.env.OIDC_REDIRECT_URI || undefined,
        scopes:
          process.env.OIDC_SCOPES || "openid profile email offline_access",
      }
    : undefined;

const apiTokenRaw = process.env.TACHY_API_TOKEN || undefined;

const sessionSecretRaw =
  process.env.TACHY_SESSION_SECRET || process.env.OIDC_AUTH_SECRET || undefined;

const envSchema = z
  .object({
    databaseUrl: z.string().url("DATABASE_URL must be a valid postgres:// URL"),
    port: z.coerce.number().int().positive("PORT must be a positive integer"),
    logLevel: z.enum(["debug", "info", "warn", "error"]),
    userEmail: z.string().email().optional(),
    /**
     * Set only by the API when it spawns an MCP subprocess for an agent turn,
     * so a write made during a turn is distinguishable from one made by someone
     * pointing their own MCP client at tachy. `turnId` joins to
     * analysis_runs.meta->>'turn_id'.
     */
    actor: z.enum(["agent", "mcp"]).optional(),
    turnId: z.string().optional(),
    apiToken: z.string().min(1).optional(),

    authMode: z.enum(["sso", "token", "open"]),
    sessionSecret: z
      .string()
      .min(
        32,
        "TACHY_SESSION_SECRET (or OIDC_AUTH_SECRET) must be at least 32 characters",
      )
      .optional(),
    oidc: z
      .object({
        issuer: z.string().url("OIDC_ISSUER must be a valid URL"),
        clientId: z.string().min(1),
        clientSecret: z.string().min(1),
        redirectUri: z.string().optional(),
        scopes: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.authMode === "sso" && !v.oidc)
      ctx.addIssue({
        code: "custom",
        path: ["oidc"],
        message:
          "authMode 'sso' requires OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET",
      });
    if (v.oidc && !v.sessionSecret)
      ctx.addIssue({
        code: "custom",
        path: ["sessionSecret"],
        message:
          "OIDC is configured but TACHY_SESSION_SECRET (>=32 chars) is not set",
      });
  });

const parsed = envSchema.safeParse({
  databaseUrl: process.env.DATABASE_URL ?? "postgres://localhost:5432/tachy",
  port: process.env.PORT ?? 8787,
  logLevel: process.env.LOG_LEVEL ?? "info",
  userEmail: process.env.TACHY_USER_EMAIL || undefined,
  actor: process.env.TACHY_ACTOR === "agent" ? "agent" : undefined,
  turnId: process.env.TACHY_TURN_ID || undefined,
  apiToken: apiTokenRaw,
  authMode:
    (process.env.TACHY_AUTH_MODE as "sso" | "token" | "open" | undefined) ??
    (oidcRaw ? "sso" : apiTokenRaw ? "token" : "open"),
  sessionSecret: sessionSecretRaw,
  oidc: oidcRaw,
});

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

/**
 * Where a chat upload lands, and the only directory the ingest tools may read
 * back. Defined here because the API writes into it and the MCP subprocess
 * reads out of it — two packages that must not disagree about which directory
 * "an uploaded file" means.
 */
export function uploadDir(): string {
  return process.env.TACHY_UPLOAD_DIR || join(tmpdir(), "tachy-uploads");
}

/**
 * Resolve a source token from env by provider + connection slug, e.g.
 * (FRESHDESK, my-freshdesk) -> FRESHDESK_TOKEN_MY_FRESHDESK,
 * falling back to the bare FRESHDESK_TOKEN.
 */
export const envVarName = (s: string) =>
  s.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

export function sourceTokenOptional(
  provider: string,
  slug: string,
): string | undefined {
  const perSlug = `${envVarName(provider)}_TOKEN_${envVarName(slug)}`;
  const bare = `${envVarName(provider)}_TOKEN`;
  return process.env[perSlug] ?? process.env[bare];
}

export function sourceToken(provider: string, slug: string): string {
  const token = sourceTokenOptional(provider, slug);
  if (!token)
    throw new Error(
      `Missing ${provider} token. Set ${envVarName(provider)}_TOKEN_${envVarName(slug)} (or ${envVarName(provider)}_TOKEN) in your env.`,
    );
  return token;
}

export const freshdeskToken = (slug: string) => sourceToken("FRESHDESK", slug);
export const githubToken = (slug: string) => sourceToken("GITHUB", slug);
export const azureDevopsToken = (slug: string) =>
  sourceToken("AZURE_DEVOPS", slug);
