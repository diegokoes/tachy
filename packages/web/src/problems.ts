import {
  problemMessage,
  readProblem,
  type ProblemDetails,
} from "@tachy/contract";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public problem?: ProblemDetails,
  ) {
    super(message);
  }
}

function parsedOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * What a refused response says, reading its body once. A body that is not a
 * problem, such as a proxy's error page, leaves the status to speak.
 */
export async function readError(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => "");
  const problem = readProblem(parsedOrUndefined(text));
  const message =
    problemMessage(problem) ??
    (response.statusText || `request failed (${response.status})`);
  return new ApiError(response.status, message, problem);
}
