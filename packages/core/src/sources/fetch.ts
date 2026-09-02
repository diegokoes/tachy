/**
 * How long one call to a source system may take. Without a deadline a hung
 * upstream hangs the tool call, the agent turn and the SSE stream behind it,
 * indefinitely and silently — nothing further up has a timeout of its own.
 */
export const SOURCE_TIMEOUT_MS = 30_000;

/**
 * `fetch` with a deadline. `label` is what the caller would have put in its own
 * error message, so a timeout reads like the adapter's other failures rather
 * than as a bare TimeoutError from somewhere in the runtime.
 */
export async function sourceFetch(
  label: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const deadline = AbortSignal.timeout(SOURCE_TIMEOUT_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, deadline])
    : deadline;
  try {
    return await fetch(url, { ...init, signal });
  } catch (e) {
    // fetch rejects with the signal's reason: a DOMException named TimeoutError.
    if (e instanceof Error && e.name === "TimeoutError")
      throw new Error(
        `${label} timed out after ${SOURCE_TIMEOUT_MS / 1000}s — the source system did not respond`,
      );
    throw e;
  }
}
