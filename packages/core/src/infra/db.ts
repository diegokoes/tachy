import postgres from "postgres";
import type { TransactionSql } from "postgres";
import { env } from "./env";

const positiveInt = (v: string | undefined) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

const testSchema = process.env.TEST_SCHEMA;
const poolMax = positiveInt(process.env.TACHY_DB_POOL_MAX);
const idleTimeout = positiveInt(process.env.TACHY_DB_IDLE_TIMEOUT);
const appName = process.env.TACHY_DB_APP_NAME;

/**
 * Pool size, idle timeout and `application_name` come from the environment so
 * each process type can be sized on its own: an MCP child per turn must not
 * hold ten connections, and `pg_stat_activity` groups by `application_name`
 * because postgres.js exposes no pool statistics.
 */
export const sql = postgres(env.databaseUrl, {
  onnotice: () => {},
  ...(poolMax ? { max: poolMax } : {}),
  ...(idleTimeout ? { idle_timeout: idleTimeout } : {}),
  connection: {
    ...(appName ? { application_name: appName } : {}),
    ...(testSchema ? { search_path: `${testSchema},public` } : {}),
  },
});

function toDate(v?: string | null): Date | null {
  return v ? new Date(v) : null;
}
export { toDate };

export type Db = typeof sql | TransactionSql;
