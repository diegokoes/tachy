/**
 * Counts failures per key inside a window, and says when a key has had its
 * share. The key is whatever the caller sent, so it is only a throttle if it is
 * also bounded: without the sweep, failures against made-up keys grow the map
 * for as long as the process runs.
 */
export function failureThrottle(
  max: number,
  windowMs = 60_000,
  maxTracked = 10_000,
) {
  const failures = new Map<string, { count: number; resetAt: number }>();
  return {
    blocked(key: string): boolean {
      const f = failures.get(key);
      return !!f && f.resetAt > Date.now() && f.count >= max;
    },
    fail(key: string): void {
      const f = failures.get(key);
      if (!f || f.resetAt < Date.now())
        failures.set(key, { count: 1, resetAt: Date.now() + windowMs });
      else f.count++;

      if (failures.size > maxTracked) {
        const now = Date.now();
        for (const [k, v] of failures) if (v.resetAt < now) failures.delete(k);
        // Still full means every window is live - drop the oldest insertions,
        // which Map iterates first. Losing one is at worst a few extra tries.
        if (failures.size > maxTracked)
          for (const k of failures.keys()) {
            failures.delete(k);
            if (failures.size <= maxTracked) break;
          }
      }
    },
  };
}
