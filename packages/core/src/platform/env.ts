import "dotenv/config";
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
    userEmail: z.string().email().optional(),
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
  userEmail: process.env.TACHY_USER_EMAIL || undefined,
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
 * Resolve a source token from env by provider + connection slug, e.g.
 * (FRESHDESK, my-freshdesk) -> FRESHDESK_TOKEN_MY_FRESHDESK,
 * falling back to the bare FRESHDESK_TOKEN.
 */
export function sourceToken(provider: string, slug: string): string {
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const perSlug = `${norm(provider)}_TOKEN_${norm(slug)}`;
  const bare = `${norm(provider)}_TOKEN`;
  const token = process.env[perSlug] ?? process.env[bare];
  if (!token)
    throw new Error(
      `Missing ${provider} token. Set ${perSlug} (or ${bare}) in your env.`,
    );
  return token;
}

export const freshdeskToken = (slug: string) => sourceToken("FRESHDESK", slug);
export const githubToken = (slug: string) => sourceToken("GITHUB", slug);
