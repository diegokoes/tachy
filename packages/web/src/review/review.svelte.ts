import type { ReviewCount } from "@tachy/contract";
import { api } from "../api";
import { session } from "../access/session.svelte";

/** What waits on the reader, for the count on the library's review tab. */
export const reviewCounts = $state<ReviewCount>({
  waiting: 0,
  returned: 0,
  flagged: 0,
});

export const reviewTotal = () =>
  reviewCounts.waiting + reviewCounts.returned + reviewCounts.flagged;

export async function loadReviewCounts(): Promise<void> {
  if (!session.me) return;
  try {
    Object.assign(reviewCounts, await api.get<ReviewCount>("/review/count"));
  } catch {
    // The count is a hint; the tab itself reports a failed load.
  }
}
