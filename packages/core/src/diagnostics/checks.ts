import {
  ANTHROPIC_API_KEY_CREDENTIAL,
  ANTHROPIC_OAUTH_CREDENTIAL,
  resolveAgentAuth,
} from "../config/credentials";
import { effectiveSettings } from "../config/settings";
import { sql } from "../infra/db";
import { secretsEnabled } from "../infra/secrets";
import { schemaStampStatus } from "../infra/schema-stamp";
import { embedQuery } from "../search/embeddings";
import { listSourceConnections } from "../sources/connections";
import { resolveSource } from "../sources/registry";

export interface Check {
  name: string;
  state: "pass" | "warn" | "fail" | "skip";
  detail: string;
}

const ms = (started: number) => Math.round(performance.now() - started);
/** An embedding slower than this passes with a warning. */
const SLOW_EMBED_MS = 2_000;

function databaseDetail(
  stamp: Awaited<ReturnType<typeof schemaStampStatus>>,
  tookMs: number,
): string {
  if (stamp === "match")
    return `answers in ${tookMs} ms, schema matches the image`;
  if (stamp === "unstamped")
    return `answers in ${tookMs} ms, schema not stamped yet`;
  return "the live schema is not the one this image expects";
}

/**
 * Fast checks, safe to run at any hour: what varies between environments, as
 * opposed to what CI already proved about the commit
 * (DEPLOYMENT-ARCHITECTURE.md §11.3).
 */
export async function runSystemChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, state: Check["state"], detail: string) =>
    checks.push({ name, state, detail });

  const dbStarted = performance.now();
  try {
    await sql`select 1`;
    const stamp = await schemaStampStatus();
    add(
      "database",
      stamp === "mismatch" ? "fail" : "pass",
      databaseDetail(stamp, ms(dbStarted)),
    );
  } catch (err) {
    add("database", "fail", String(err));
  }

  const embedStarted = performance.now();
  try {
    const vector = await embedQuery("a health check query");
    const took = ms(embedStarted);
    add(
      "embedding",
      took > SLOW_EMBED_MS ? "warn" : "pass",
      `${vector.length}-dim vector in ${took} ms`,
    );
  } catch (err) {
    add("embedding", "fail", String(err));
  }

  if (!secretsEnabled()) add("vault", "skip", "TACHY_SECRET_KEY is not set");
  else {
    try {
      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from credentials
      `;
      // Decrypting any one stored credential proves the key still opens them.
      const [one] = await sql`select name, scope from credentials limit 1`;
      if (!one) add("vault", "pass", "enabled; nothing stored yet");
      else {
        const { resolveCredential } = await import("../config/credentials");
        const value = await resolveCredential(one.name as string, {});
        add(
          "vault",
          value === undefined ? "fail" : "pass",
          value === undefined
            ? `the key does not decrypt '${one.name}'`
            : `${row.n} credential(s), the key decrypts them`,
        );
      }
    } catch (err) {
      add("vault", "fail", String(err));
    }
  }

  for (const conn of await listSourceConnections()) {
    const started = performance.now();
    try {
      const { source } = await resolveSource(conn.slug);
      if (!source.verify) add(`source ${conn.slug}`, "skip", "no test call");
      else {
        await source.verify();
        add(`source ${conn.slug}`, "pass", `answers in ${ms(started)} ms`);
      }
    } catch (err) {
      add(`source ${conn.slug}`, "fail", String(err));
    }
  }

  // Agent keys are each user's own, so there is no key to resolve without a
  // user to be. The environment's fallback counts for everyone; otherwise the
  // question is whether anyone has brought one.
  const auth = await resolveAgentAuth({});
  const [{ n: byUser }] = await sql<{ n: number }[]>`
    select count(*)::int as n from credentials
    where scope = 'user'
      and name = any(${[ANTHROPIC_API_KEY_CREDENTIAL, ANTHROPIC_OAUTH_CREDENTIAL]})
  `;
  const ownCredentials =
    byUser > 0
      ? `${byUser} user(s) hold their own credential`
      : "no credential for the model";
  add(
    "agent",
    auth || byUser > 0 ? "pass" : "fail",
    auth ? `credential available (${auth.kind})` : ownCredentials,
  );

  return checks;
}
