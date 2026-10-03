import { api } from "../api";
import { createResource } from "../resource.svelte";
import type { TestRun } from "./loadRuns";
import type { SystemInfo } from "./rows";

export type Probe = { name: string; state: string; detail: string };
export type Target = { name: string; url: string; dev: boolean };
export type ScriptRule = {
  script: string;
  any_time: boolean;
  dev_only: boolean;
};

/**
 * The system page's three sources, as module singletons: the overview and the
 * dialogs over it are siblings reading the same answers, and a setting saved
 * in one dialog has to show on the overview the moment it closes.
 */
export const system = createResource(
  () => api.get<SystemInfo>("/system"),
  null as SystemInfo | null,
);

export const loads = createResource(
  () =>
    api.get<{
      runs: TestRun[];
      targets: Target[];
      scripts: ScriptRule[];
      in_window: boolean;
    }>("/tests/runs"),
  { runs: [], targets: [], scripts: [], in_window: false },
);

/**
 * Environment probes: database, embedding, vault decrypt, one per source
 * connection, one per agent backend. Run on request, never on the overview's
 * refresh: a source probe is a call to someone else's API, and ten-second
 * polling would be a small denial of service against it.
 */
let probeState = $state<{
  checks: Probe[] | null;
  at: number | null;
  running: boolean;
  error: string | null;
}>({ checks: null, at: null, running: false, error: null });

export const probes = {
  get checks() {
    return probeState.checks;
  },
  get at() {
    return probeState.at;
  },
  get running() {
    return probeState.running;
  },
  get error() {
    return probeState.error;
  },
};

export async function runProbes() {
  if (probeState.running) return;
  probeState.running = true;
  probeState.error = null;
  try {
    const res = await api.get<{ checks: Probe[] }>("/tests/checks");
    probeState.checks = res.checks;
    probeState.at = Date.now();
  } catch (e) {
    probeState.error = e instanceof Error ? e.message : String(e);
  } finally {
    probeState.running = false;
  }
}

/**
 * How the last probe run came out. A skipped probe (a backend nobody has
 * configured) is neither a pass nor a failure, so it counts toward neither.
 */
export function probeTally(checks: Probe[] | null) {
  if (!checks) return null;
  const n = (state: string) => checks.filter((c) => c.state === state).length;
  return {
    total: checks.length,
    passing: n("pass"),
    warning: n("warn"),
    failing: n("fail"),
    skipped: n("skip"),
  };
}
