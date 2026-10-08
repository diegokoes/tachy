import type { FlowActionInfo, FlowOption } from "@tachy/contract";
import { api } from "../api";

const cache = new Map<string, Promise<FlowOption[]>>();

/**
 * A named option list from the server, read once per session and set of
 * dependencies: a source's companies or a project's types do not change while
 * someone builds a flow.
 */
export function fetchOptions(
  key: string,
  deps: Record<string, string> = {},
): Promise<FlowOption[]> {
  const query = new URLSearchParams(
    Object.entries(deps).filter(([, v]) => v !== ""),
  ).toString();
  const url = `/flows/options/${encodeURIComponent(key)}${query ? `?${query}` : ""}`;
  let hit = cache.get(url);
  if (!hit) {
    hit = api.get<FlowOption[]>(url);
    hit.catch(() => cache.delete(url));
    cache.set(url, hit);
  }
  return hit;
}

let catalog: Promise<FlowActionInfo[]> | null = null;

export function fetchActions(): Promise<FlowActionInfo[]> {
  catalog ??= api.get<FlowActionInfo[]>("/flows/actions");
  catalog.catch(() => (catalog = null));
  return catalog;
}
