import { api } from "../api";
import { errText } from "../resource.svelte";

import type { AgentProvider } from "@tachy/contract";

export type PrefSource = "user" | "team" | "db" | "env" | "default";
export type Pref<T> = { value: T; source: PrefSource };

export type Prefs = {
  agent_provider: Pref<AgentProvider>;
  agent_model: Pref<string>;
  agent_effort: Pref<string>;
};

export type KeyScope = "user" | "team" | "global" | "env";

export type MyCreds = {
  vault_enabled: boolean;
  mine: { name: string; updated_at: string }[];
  effective: Record<string, KeyScope | null>;
};

/**
 * One load for the whole agent area. A module singleton rather than state
 * inside a component, for the same reason as the admin census: the preferences
 * and the keys are two sections of the same scrolling page now, they are served
 * by two requests that always travel together, and a write to either one
 * re-reads both.
 */
export const agentPrefs = $state({
  prefs: null as Prefs | null,
  creds: null as MyCreds | null,
  error: null as string | null,
  loading: false,
});

export async function loadAgent() {
  agentPrefs.loading = true;
  agentPrefs.error = null;
  try {
    const [p, c] = await Promise.all([
      api.get<Prefs>("/me/preferences"),
      api.get<MyCreds>("/me/credentials"),
    ]);
    agentPrefs.prefs = p;
    agentPrefs.creds = c;
  } catch (e) {
    agentPrefs.error = errText(e);
  } finally {
    agentPrefs.loading = false;
  }
}

/** Runs `fn`, then re-reads — every write here changes what is effective. */
async function write(fn: () => Promise<unknown>) {
  agentPrefs.error = null;
  try {
    await fn();
    await loadAgent();
  } catch (e) {
    agentPrefs.error = errText(e);
  }
}

export const setPref = (key: string, value: unknown) =>
  write(() => api.put(`/me/preferences/${key}`, { value }));

export const resetPref = (key: string) =>
  write(() => api.delete(`/me/preferences/${key}`));

export const saveKey = (name: string, value: string) =>
  write(() =>
    api.put(`/me/credentials/${encodeURIComponent(name)}`, { value }),
  );

export const removeKey = (name: string) =>
  write(() => api.delete(`/me/credentials/${encodeURIComponent(name)}`));

/**
 * One sentence for every inherited value in this view, wherever it lands:
 * where it comes from, and that you can take it over. A value of your own says
 * nothing — the reset mark is the whole story.
 */
export const heldBy = (source: PrefSource | KeyScope | null) => {
  if (!source || source === "user") return "";
  return `${source === "db" ? "global" : source} · override`;
};
