import { z } from "zod";

const MAX_TOKEN_DAYS = 3650;

export const tokenSchema = z.object({
  name: z.string().trim().min(1).max(100),
  /** Absent: the default lifetime. Null: the token does not expire. */
  expires_in_days: z.number().int().min(1).max(MAX_TOKEN_DAYS).nullish(),
});
