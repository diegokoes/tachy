import { z } from "zod";

const DAY_MS = 86_400_000;
const MAX_TOKEN_DAYS = 3650;

export const tokenSchema = z.object({
  name: z.string().trim().min(1).max(100),
  /** Absent or null: the token does not expire. */
  expires_in_days: z.number().int().min(1).max(MAX_TOKEN_DAYS).nullish(),
});

export const expiryOf = (days: number | null | undefined): Date | null =>
  days ? new Date(Date.now() + days * DAY_MS) : null;
