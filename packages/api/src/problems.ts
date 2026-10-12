import { STATUS_CODES } from "node:http";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  PROBLEM_TYPES,
  type ProblemDetails,
  type ProblemSlug,
} from "@tachy/core";
import { maskSecrets } from "@tachy/core/infra";

export const PROBLEM_JSON = "application/problem+json";

/** `problem` names a minted type; any other member is an extension of the body. */
export interface ProblemInput {
  problem?: ProblemSlug;
  detail?: string;
  [extension: string]: unknown;
}

/**
 * The one way the API answers an error: `application/problem+json` whose
 * `status` member is the HTTP status. Headers set on the context beforehand,
 * such as Retry-After, go out with it.
 */
export function problem(
  c: Context,
  status: ContentfulStatusCode,
  { problem: slug, detail, ...extensions }: ProblemInput = {},
): Response {
  const minted = slug ? PROBLEM_TYPES[slug] : undefined;
  const body: ProblemDetails = {
    type: minted?.type ?? "about:blank",
    title: minted?.title ?? STATUS_CODES[status],
    status,
    ...(detail ? { detail } : {}),
    ...extensions,
  };
  return c.body(maskSecrets(JSON.stringify(body)), status, {
    "content-type": PROBLEM_JSON,
  });
}
