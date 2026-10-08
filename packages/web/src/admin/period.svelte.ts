/**
 * How far back the chart open in the window looks. Unset, every overview reads
 * its own default; a detail view sets it, and the resources that take a window
 * reload with it.
 */
export const period = $state<{ days?: number }>({});

export const PERIODS = [7, 14, 30, 90] as const;

const listeners = new Set<() => void>();

/** A resource that takes a window registers here to be reloaded when it changes. */
export function followPeriod(reload: () => void) {
  listeners.add(reload);
  return () => listeners.delete(reload);
}

export function setPeriod(days: number | undefined) {
  if (period.days === days) return;
  period.days = days;
  for (const reload of listeners) reload();
}

/** The query a window-taking route is asked with. */
export const periodQuery = () => (period.days ? `?days=${period.days}` : "");
