import http from "k6/http";
import { check, fail } from "k6";
import { BASE_URL, headers, setupSession, pick } from "./lib/session.js";
import { QUERIES } from "./lib/corpus.js";

/**
 * Search while the host embeds in bulk. Proves the separation in
 * DEPLOYMENT-ARCHITECTURE.md §5.4: with the model in its own queue, a backfill
 * or reindex must not push search latency past 1.5x its idle baseline.
 *
 *   BASELINE_P95_MS  search.js's knowledge_search p95 on the same target, idle
 *   ADMIN_TOKEN      an API token; with it, setup starts embeddings.backfill
 *                    (all=true) itself. Without it, start a reindex by hand
 *                    before the run.
 */
const BASELINE = Number(__ENV.BASELINE_P95_MS || 0);

export const options = {
  scenarios: {
    search: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE || 5),
      timeUnit: "1s",
      duration: __ENV.DURATION || "3m",
      preAllocatedVUs: 20,
      maxVUs: 60,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{endpoint:knowledge_search}": [
      `p(95)<${Math.round((BASELINE || 1000) * 1.5)}`,
    ],
  },
};

export function setup() {
  if (!BASELINE)
    fail("set BASELINE_P95_MS to the idle knowledge_search p95 from search.js");
  const data = setupSession();
  if (__ENV.ADMIN_TOKEN) {
    const res = http.post(
      `${BASE_URL}/api/jobs/runs`,
      JSON.stringify({ kind: "embeddings.backfill", params: { all: true } }),
      {
        headers: {
          Authorization: `Bearer ${__ENV.ADMIN_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );
    check(res, { "backfill queued": (r) => r.status === 202 });
  }
  return data;
}

export default function (data) {
  check(
    http.get(
      `${BASE_URL}/api/knowledge/search?q=${encodeURIComponent(pick(QUERIES))}`,
      {
        headers: headers(data),
        tags: { endpoint: "knowledge_search" },
        timeout: "60s",
      },
    ),
    { "knowledge search ok": (r) => r.status === 200 },
  );
}
