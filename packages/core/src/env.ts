import "dotenv/config";

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://tachy:tachy@localhost:5432/tachy",
  port: Number(process.env.PORT ?? 8787),
  userEmail: process.env.TACHY_USER_EMAIL,
  apiToken: process.env.TACHY_API_TOKEN,
};

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
