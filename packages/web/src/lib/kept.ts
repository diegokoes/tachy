/**
 * What a view was showing when it unmounted, for the next time it mounts.
 *
 * App renders one section at a time, so leaving one destroys its component
 * state: a search, a filter, an open dialog. A view seeds that state from here
 * and writes it back as it changes. Memory only, so a reload still opens clean.
 */
const kept = new Map<string, unknown>();

export function recall<T>(key: string, fallback: T): T {
  return kept.has(key) ? (kept.get(key) as T) : fallback;
}

export function keep<T>(key: string, value: T): void {
  kept.set(key, value);
}

export function forget(key: string): void {
  kept.delete(key);
}
