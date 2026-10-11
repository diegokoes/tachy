import type { Context, ValidationTargets } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { z } from "zod";
import { noteError } from "./logging";
import { problem } from "./problems";

type Issue = { path: readonly PropertyKey[]; message: string };

const issueText = (issue: Issue) =>
  issue.path.length
    ? `${issue.path.join(".")}: ${issue.message}`
    : issue.message;

/** A 400 whose detail names each failing field. */
export function invalidRequest(c: Context, issues: readonly Issue[]): Response {
  noteError(c, { error: "validation failed", issues });
  return problem(c, 400, { detail: issues.map(issueText).join("; ") });
}

/**
 * zValidator answering a refusal as a problem. Its own answer is the parse
 * result as JSON, whose `error` member is an object.
 */
export const validate = <
  Schema extends z.ZodType,
  Target extends keyof ValidationTargets,
>(
  target: Target,
  schema: Schema,
) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) return invalidRequest(c, result.error.issues);
  });
