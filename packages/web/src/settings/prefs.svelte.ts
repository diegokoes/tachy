import { api } from "../api";
import { errText } from "../resource.svelte";

import type {
  AgentEffort,
  AgentProvider,
  Clock,
  DateOrder,
} from "@tachy/contract";

export type PrefSource = "user" | "team" | "db" | "env" | "default";
export type Pref<T> = { value: T; source: PrefSource };

export type Prefs = {
  agent_provider: Pref<AgentProvider>;
  agent_model: Pref<string>;
  agent_effort: Pref<string>;
  date_order: Pref<DateOrder>;
  clock: Pref<Clock>;
};

export type KeyScope = "user" | "team" | "global" | "env";

export type MyCreds = {
  vault_enabled: boolean;
  mine: { name: string; updated_at: string }[];
  effective: Record<string, KeyScope | null>;
  /** The credential a chat turn would pick right now. */
  agent: {
    provider: AgentProvider;
    in_use: string | null;
    source: KeyScope | null;
  };
};

export type ModelChoice = {
  id: string;
  label: string;
  efforts: AgentEffort[];
  defaultEffort?: AgentEffort;
};

export type ModelList = {
  provider: AgentProvider;
  /** Empty when the runtime could not be asked and no allow-list applies. */
  models: ModelChoice[];
  restricted: boolean;
  error: string | null;
};

/**
 * One load for the whole agent area. A module singleton rather than state
 * inside a component, for the same reason as the admin census: the preferences
 * and the keys are two groups of the same tab, they are served
 * by two requests that always travel together, and a write to either one
 * re-reads both.
 */
export const agentPrefs = $state({
  prefs: null as Prefs | null,
  creds: null as MyCreds | null,
  models: null as ModelList | null,
  modelsLoading: false,
  error: null as string | null,
  loading: false,
});

/** Asked of the runtime, so slow next to a preference read: it lands on its
 *  own and is fetched again only when the provider it describes changes. */
async function loadModels() {
  agentPrefs.modelsLoading = true;
  try {
    agentPrefs.models = await api.get<ModelList>("/me/models");
  } catch (e) {
    agentPrefs.models = null;
    agentPrefs.error = errText(e);
  } finally {
    agentPrefs.modelsLoading = false;
  }
}

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
    if (agentPrefs.models?.provider !== p.agent_provider.value)
      void loadModels();
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

export type Origin = { label: string; tip: string; mine: boolean };

const INHERITED: Record<
  Exclude<PrefSource | KeyScope, "user">,
  [string, string]
> = {
  team: ["team", "your team's admin"],
  db: ["org", "an admin, for everyone"],
  global: ["org", "an admin, for everyone"],
  env: ["server", "the server's configuration"],
  default: ["built-in", "tachy itself"],
};

/**
 * Where a value comes from, in words that say what picking another one does:
 * an inherited value keeps following whoever set it until you choose your own,
 * and yours stays until you reset it.
 */
export function origin(
  source: PrefSource | KeyScope | null,
  noun: "default" | "key",
): Origin | null {
  if (!source) return null;
  if (source === "user")
    return {
      label: "yours",
      tip:
        noun === "key"
          ? "Your own key. Remove it to fall back to a shared one, if there is one."
          : "Your own choice. Reset it to follow the shared default again.",
      mine: true,
    };
  const [who, by] = INHERITED[source];
  return {
    label: `${who} ${noun}`,
    tip:
      noun === "key"
        ? `Shared key set by ${by}. Paste your own to use it instead.`
        : `Set by ${by}. Pick a value to make it your own.`,
    mine: false,
  };
}
