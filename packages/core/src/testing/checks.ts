import { AGENT_CREDENTIALS, resolveAgentAuth } from "../config/credentials";
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

/**
 * Fast checks, safe to run at any hour: what actually varies between
 * environments, as opposed to what CI already proved about the commit
 * (DEPLOYMENT-ARCHITECTURE.md §11.3).
 */
export async function runSystemChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, state: Check["state"], detail: string) =>
    checks.push({ name, state, detail });

  const t0 = performance.now();
  try {
    await sql`select 1`;
    const stamp = await schemaStampStatus();
    add(
      "database",
      stamp === "mismatch" ? "fail" : "pass",
      stamp === "match"
        ? `answers in ${ms(t0)} ms, schema matches the image`
        : stamp === "unstamped"
          ? `answers in ${ms(t0)} ms, schema not stamped yet`
          : "the live schema is not the one this image expects",
    );
  } catch (err) {
    add("database", "fail", String(err));
  }

  const t1 = performance.now();
  try {
    const v = await embedQuery("a health check query");
    const took = ms(t1);
    add(
      "embedding",
      took > 2_000 ? "warn" : "pass",
      `${v.length}-dim vector in ${took} ms`,
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
    const t = performance.now();
    try {
      const { source } = await resolveSource(conn.slug);
      if (!source.verify) add(`source ${conn.slug}`, "skip", "no test call");
      else {
        await source.verify();
        add(`source ${conn.slug}`, "pass", `answers in ${ms(t)} ms`);
      }
    } catch (err) {
      add(`source ${conn.slug}`, "fail", String(err));
    }
  }

  const settings = await effectiveSettings();
  for (const provider of ["claude", "copilot"] as const) {
    const auth = await resolveAgentAuth(provider, {});
    const inUse = settings.agent_provider.value === provider;
    add(
      `agent ${provider}`,
      auth ? "pass" : inUse ? "fail" : "skip",
      auth
        ? `credential available (${auth.kind})`
        : inUse
          ? `no credential, and ${provider} is the configured backend`
          : "no credential; not the configured backend",
    );
    void AGENT_CREDENTIALS;
  }

  return checks;
}
