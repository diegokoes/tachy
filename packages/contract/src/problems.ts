/**
 * RFC 9457 problem details, the one body the API answers an error with. A type
 * is minted only where a client branches on it; every other problem is
 * `about:blank`, titled with its status phrase.
 */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  [extension: string]: unknown;
}

export const PROBLEM_TYPES = {
  "turn-in-progress": {
    type: "/problems/turn-in-progress",
    title: "A chat turn is already running",
  },
} as const;

export type ProblemSlug = keyof typeof PROBLEM_TYPES;

const STRING_MEMBERS = ["type", "title", "detail"] as const;

/**
 * The problem a parsed body carries, or undefined when it carries none. A
 * member of the wrong type is dropped, not trusted (RFC 9457 §3.1).
 */
export function readProblem(body: unknown): ProblemDetails | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return undefined;
  const problem: ProblemDetails = { ...body };
  for (const member of STRING_MEMBERS)
    if (typeof problem[member] !== "string") delete problem[member];
  if (typeof problem.status !== "number") delete problem.status;
  const carriesOne =
    STRING_MEMBERS.some((member) => member in problem) || "status" in problem;
  return carriesOne ? problem : undefined;
}

/** The sentence a person reads: `detail`, else `title`. */
export const problemMessage = (problem: ProblemDetails | undefined) =>
  problem?.detail ?? problem?.title;

export const isProblemType = (
  problem: ProblemDetails | undefined,
  slug: ProblemSlug,
) => problem?.type === PROBLEM_TYPES[slug].type;
