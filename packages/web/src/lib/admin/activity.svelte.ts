import { api } from "../api";
import { createResource } from "../resource.svelte";
import type { Activity } from "./rows";

const EMPTY: Activity = {
  usage: {
    days: 30,
    turns: 0,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    active_7d: 0,
    active: 0,
    per_day: [],
    by_model: [],
  },
  tools: { days: 30, reads: 0, writes: 0, tools: [], per_day: [] },
  traffic: { days: 14, connections: [], per_day: [] },
  library: {
    days: 30,
    reads: 0,
    readers: 0,
    corrections: 0,
    per_day: [],
    edits_per_day: [],
    top: [],
  },
};

/**
 * The overviews' activity, beside the census rather than inside it: the census
 * also feeds the rail's counts on every page, and these scan run logs and day
 * buckets that only the overviews render.
 *
 * Laid over EMPTY for the same reason as the census — a newer bundle against
 * an older API must lose a figure, not the panel.
 */
export const activity = createResource(async () => {
  const got = await api.get<Partial<Activity>>("/overview/activity");
  return {
    usage: { ...EMPTY.usage, ...got.usage },
    tools: { ...EMPTY.tools, ...got.tools },
    traffic: { ...EMPTY.traffic, ...got.traffic },
    library: { ...EMPTY.library, ...got.library },
  };
}, EMPTY);
