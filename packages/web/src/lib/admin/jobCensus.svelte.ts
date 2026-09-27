import { api } from "../api";
import { createResource } from "../resource.svelte";
import type { JobCensus } from "./rows";

const zero = { light: 0, heavy: 0 };

export const EMPTY_JOBS: JobCensus = {
  days: 14,
  runs: 0,
  by_status: {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    timed_out: 0,
  },
  by_trigger: { schedule: 0, manual: 0, event: 0 },
  by_class: { ...zero },
  per_day: [],
  by_kind: [],
  success: {
    light: { finished: 0, succeeded: 0 },
    heavy: { finished: 0, succeeded: 0 },
  },
  now: { light: { running: 0, queued: 0 }, heavy: { running: 0, queued: 0 } },
  definitions: {
    total: 0,
    enabled: 0,
    scheduled: 0,
    manual: 0,
    disabled: 0,
    by_class: { ...zero },
  },
  failures: [],
  upcoming: [],
};

/**
 * The workers page's census, as a module singleton for the same reason the
 * admin census is one: the overview and the failures dialog over it are
 * siblings reading one answer, and a pause or delete in the jobs list has to
 * be able to refresh it.
 *
 * Laid over EMPTY_JOBS so a newer bundle against an older API loses a figure
 * rather than the panel.
 */
export const jobs = createResource(async () => {
  const got = await api.get<Partial<JobCensus>>("/jobs/census");
  return {
    ...EMPTY_JOBS,
    ...got,
    definitions: { ...EMPTY_JOBS.definitions, ...got.definitions },
  } as JobCensus;
}, EMPTY_JOBS);
