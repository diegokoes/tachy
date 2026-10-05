import { onDestroy, onMount } from "svelte";
import { api } from "../api";
import { createResource } from "../resource.svelte";
import type { JobLive } from "@tachy/contract";

const EMPTY: JobLive = { workers: [], queues: [] };

/**
 * Workers and queue backlogs as they are now, shared by the overview and the
 * workers section. Polled only while one of them is on screen.
 */
export const live = createResource(
  async () => ({
    ...EMPTY,
    ...(await api.get<Partial<JobLive>>("/jobs/live")),
  }),
  EMPTY,
);

let watchers = 0;
let timer: ReturnType<typeof setInterval> | undefined;

/** Call from a component's setup: follows the live state while it is mounted. */
export function followLive(everyMs = 2_000) {
  onMount(() => {
    if (watchers++ === 0) {
      void live.reload();
      timer = setInterval(() => void live.reload(), everyMs);
    }
  });
  onDestroy(() => {
    if (--watchers === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  });
}
