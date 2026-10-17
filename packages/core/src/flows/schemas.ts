/**
 * Flow schema parts ingest rules share. A leaf module: graph.ts imports the
 * action catalog, which imports ingest.ts.
 */
import { z } from "zod";
import { CONDITION_OPS, type Condition } from "@tachy/contract";

export const flowId = z
  .string()
  .regex(/^[\w-]{1,40}$/, "ids are letters, digits, _ and -");

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema).max(50) }).strict(),
    z.object({ any: z.array(conditionSchema).max(50) }).strict(),
    z.object({ not: conditionSchema }).strict(),
    z
      .object({
        field: z.string().min(1),
        op: z.enum(CONDITION_OPS),
        value: z.unknown().optional(),
      })
      .strict(),
  ]),
);
