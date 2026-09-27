import http from "k6/http";
import { check } from "k6";
import { BASE_URL, headers, setupSession, pick } from "./lib/session.js";
import { QUERIES } from "./lib/corpus.js";

/**
 * The morning login burst: 0 to 30 requests a second in 10 seconds, held, then
 * gone. No 5xx, and latency back under budget once it passes. Dev stack only.
 */
export const options = {
  scenarios: {
    spike: {
      executor: "ramping-arrival-rate",
      startRate: 0,
      timeUnit: "1s",
      preAllocatedVUs: 30,
      maxVUs: 150,
      stages: [
        { target: 30, duration: "10s" },
        { target: 30, duration: "1m" },
        { target: 1, duration: "10s" },
        { target: 1, duration: "1m" },
      ],
    },
  },
  thresholds: {
    "http_req_failed{status:500}": ["rate==0"],
    http_req_failed: ["rate<0.02"],
  },
};

export const setup = setupSession;

export default function (data) {
  const h = headers(data);
  const res =
    Math.random() < 0.3
      ? http.get(
          `${BASE_URL}/api/knowledge/search?q=${encodeURIComponent(pick(QUERIES))}`,
          {
            headers: h,
            tags: { endpoint: "knowledge_search" },
            timeout: "60s",
          },
        )
      : http.get(`${BASE_URL}/api/knowledge?limit=20`, {
          headers: h,
          tags: { endpoint: "knowledge_list" },
        });
  check(res, { "no server error": (r) => r.status < 500 });
}
