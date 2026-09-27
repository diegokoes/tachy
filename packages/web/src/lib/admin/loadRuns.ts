export type TestRun = {
  id: string;
  script: string;
  profile: string | null;
  target: string;
  status: string;
  image_sha: string | null;
  summary: Record<string, any> | null;
  output_tail: string;
  created_at: string;
  finished_at: string | null;
};

type Metric = Record<string, number | undefined>;
const metrics = (run: TestRun) =>
  (run.summary?.metrics ?? {}) as Record<string, Metric>;

const ENDPOINT = "http_req_duration{endpoint:";

/** p95 per endpoint from k6's summary, which is what a release is compared on. */
export const endpointP95 = (run: TestRun) =>
  Object.entries(metrics(run))
    .filter(([name]) => name.startsWith(ENDPOINT))
    .map(([name, m]) => ({
      endpoint: name.slice(ENDPOINT.length, -1),
      ms: Math.round(m["p(95)"] ?? 0),
    }));

/** p95 across every request of the run, or null when k6 recorded none. */
export const runP95 = (run: TestRun): number | null => {
  const p = metrics(run).http_req_duration?.["p(95)"];
  return typeof p === "number" ? Math.round(p) : null;
};

const PASSED = "passed";
const FAILED = new Set(["failed", "error"]);

export type LoadSummary = {
  runs: number;
  /** Runs that reached a verdict. Queued, running and cancelled ones have none. */
  judged: number;
  passed: number;
  /** passed / judged, or null with nothing judged, not a 0% nobody earned. */
  passRate: number | null;
  stress: number;
  /** Most-run script first. */
  byScript: { script: string; runs: number; passed: number; stress: number }[];
};

/** What the load-test history says at a glance: how often, how well, which. */
export function loadSummary(runs: TestRun[]): LoadSummary {
  const scripts = new Map<
    string,
    { runs: number; passed: number; stress: number }
  >();
  let judged = 0;
  let passed = 0;
  let stress = 0;
  for (const r of runs) {
    const s = scripts.get(r.script) ?? { runs: 0, passed: 0, stress: 0 };
    s.runs += 1;
    if (r.profile === "stress") {
      s.stress += 1;
      stress += 1;
    }
    if (r.status === PASSED || FAILED.has(r.status)) judged += 1;
    if (r.status === PASSED) {
      passed += 1;
      s.passed += 1;
    }
    scripts.set(r.script, s);
  }
  return {
    runs: runs.length,
    judged,
    passed,
    passRate: judged ? passed / judged : null,
    stress,
    byScript: [...scripts]
      .map(([script, s]) => ({ script, ...s }))
      .sort((a, b) => b.runs - a.runs || a.script.localeCompare(b.script)),
  };
}
