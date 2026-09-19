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
