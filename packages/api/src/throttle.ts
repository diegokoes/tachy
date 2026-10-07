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
      const entry = failures.get(key);
      return !!entry && entry.resetAt > Date.now() && entry.count >= max;
    },
    fail(key: string): void {
      const entry = failures.get(key);
      if (!entry || entry.resetAt < Date.now())
        failures.set(key, { count: 1, resetAt: Date.now() + windowMs });
      else entry.count++;

      if (failures.size > maxTracked) {
        const now = Date.now();
        for (const [candidate, counted] of failures)
          if (counted.resetAt < now) failures.delete(candidate);
        // Still full means every window is live - drop the oldest insertions,
        // which Map iterates first. Losing one is at worst a few extra tries.
        if (failures.size > maxTracked)
          for (const oldest of failures.keys()) {
            failures.delete(oldest);
            if (failures.size <= maxTracked) break;
          }
      }
    },
  };
}
