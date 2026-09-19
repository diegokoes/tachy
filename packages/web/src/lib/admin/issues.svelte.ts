import { api } from "../api";
import { createResource } from "../resource.svelte";
import type { Issues } from "./rows";

let page = "integrations";

/**
 * The open issues of one admin page, named. A module singleton beside the
 * census: the top-right button counts them on every page and the modal lists
 * them, and neither is a parent of the other.
 */
export const issues = createResource(
  () => api.get<Issues>(`/overview/issues?page=${encodeURIComponent(page)}`),
  {} as Issues,
);

export function loadIssues(next: string) {
  if (next !== page) issues.data = {};
  page = next;
  return issues.reload();
}
