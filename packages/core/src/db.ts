import postgres from "postgres";
import { env } from "./env";

// Single shared connection. postgres.js is the only DB dependency: SQL stays
// visible and there is no ORM layer to fight. Swap to a pool/Drizzle later if wanted.
export const sql = postgres(env.databaseUrl, { onnotice: () => {} });

function toDate(v?: string | null): Date | null {
  return v ? new Date(v) : null;
}
export { toDate };
