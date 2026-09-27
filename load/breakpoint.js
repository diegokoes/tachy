import http from "k6/http";
import { check } from "k6";
import { BASE_URL, headers, setupSession, pick } from "./lib/session.js";
import { QUERIES } from "./lib/corpus.js";

/**
 * Raises the arrival rate until search misses its budget, then stops. The rate
 * it stopped at is the knee for this release; record it with the image SHA.
 * Dev stack only.
 */
export const options = {
  scenarios: {
    breakpoint: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: [
        {
          target: Number(__ENV.MAX_RATE || 200),
          duration: __ENV.DURATION || "10m",
        },
      ],
    },
  },
  thresholds: {
    "http_req_duration{endpoint:knowledge_search}": [
      { threshold: "p(95)<1500", abortOnFail: true, delayAbortEval: "30s" },
    ],
    http_req_failed: [
      { threshold: "rate<0.05", abortOnFail: true, delayAbortEval: "30s" },
    ],
  },
};

export const setup = setupSession;

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
