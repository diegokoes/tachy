import type { KnowledgeStale } from "@tachy/contract";
import { api } from "../api";
import { createResource } from "../resource.svelte";

const EMPTY: KnowledgeStale = {
  drafts: [],
  untouched: 0,
  unread: 0,
  doubtful: 0,
  weakest: [],
};

/** What in the approved library has gone stale, and what waits on a review. */
export const stale = createResource(
  () => api.get<KnowledgeStale>("/overview/stale"),
  EMPTY,
);
