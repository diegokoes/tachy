import { log } from "./log";

const pending = new Set<Promise<unknown>>();

/**
 * Run bookkeeping nobody waits for — a view count, a tool-call count — while
 * keeping hold of it. The request never waits; something that is about to take
 * the tables away from under it can, which is what `backgroundSettled` is for.
 * A failure is logged under `event` and swallowed: failing to count is not
 * failing to act.
 */
export function inBackground(work: Promise<unknown>, event: string): void {
  const tracked: Promise<unknown> = work
    .catch((e) => log("warn", event, { error: String(e) }))
    .finally(() => pending.delete(tracked));
  pending.add(tracked);
}

/**
 * Resolves once nothing started by `inBackground` is still running. A truncate
 * that races an in-flight counting insert deadlocks; this is the wait that
 * prevents it.
 */
export async function backgroundSettled(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}
