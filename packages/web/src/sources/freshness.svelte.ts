import type { Freshness } from "@tachy/contract";
import { api } from "../api";
import { createResource } from "../resource.svelte";

/** When each source, repo and bucket was last brought up to date. */
export const freshness = createResource(
  () => api.get<Freshness[]>("/overview/freshness"),
  [] as Freshness[],
);
