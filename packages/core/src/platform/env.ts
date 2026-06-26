import "dotenv/config";
import { z } from "zod";

// Validate config at import so a misconfig fails fast with a clear message, instead
// of surfacing as a cryptic Postgres/HTTP error deep in a request later.
const envSchema = z.object({
  databaseUrl: z.string().url("DATABASE_URL must be a valid postgres:// URL"),
  port: z.coerce.number().int().positive("PORT must be a positive integer"),
  userEmail: z.string().email().optional(),
  apiToken: z.string().min(1).optional(),
});

const parsed = envSchema.safeParse({
  databaseUrl: process.env.DATABASE_URL ?? "postgres://tachy:tachy@localhost:5432/tachy",
  port: process.env.PORT ?? 8787,
  userEmail: process.env.TACHY_USER_EMAIL || undefined,
  apiToken: process.env.TACHY_API_TOKEN || undefined,
});

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
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
  if (!token) throw new Error(`Missing ${provider} token. Set ${perSlug} (or ${bare}) in your env.`);
  return token;
}

export const freshdeskToken = (slug: string) => sourceToken("FRESHDESK", slug);
export const githubToken = (slug: string) => sourceToken("GITHUB", slug);
