import postgres from "postgres";
import { env } from "./env";

export const sql = postgres(env.databaseUrl, { onnotice: () => {} });

function toDate(v?: string | null): Date | null {
  return v ? new Date(v) : null;
}
export { toDate };
