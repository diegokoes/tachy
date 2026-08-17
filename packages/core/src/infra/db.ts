import postgres from "postgres";
import { env } from "./env";

const testSchema = process.env.TEST_SCHEMA;
export const sql = postgres(env.databaseUrl, {
  onnotice: () => {},
  ...(testSchema
    ? { connection: { search_path: `${testSchema},public` } }
    : {}),
});

function toDate(v?: string | null): Date | null {
  return v ? new Date(v) : null;
}
export { toDate };
