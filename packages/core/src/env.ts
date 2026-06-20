import "dotenv/config";

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://tachy:tachy@localhost:5432/tachy",
  port: Number(process.env.PORT ?? 8787),
};

/** Resolve a source token from env by connection slug, e.g. osapiens-freshdesk -> FRESHDESK_TOKEN_OSAPIENS_FRESHDESK. */
export function freshdeskToken(slug: string): string {
  const key = `FRESHDESK_TOKEN_${slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const token = process.env[key] ?? process.env.FRESHDESK_TOKEN;
  if (!token) throw new Error(`Missing Freshdesk token. Set ${key} (or FRESHDESK_TOKEN) in your env.`);
  return token;
}
