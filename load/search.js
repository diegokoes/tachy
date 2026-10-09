/**
 * The endpoint most likely to fall over. Every query is embedded before it
 * touches Postgres, by one model that runs one batch at a time, so concurrency
 * here queues on the model and the wait grows once it saturates. PROFILE=stress
 * looks for the knee instead of holding a bar.
 */
import http from "k6/http";
import { check } from "k6";
import { BASE_URL, headers, setupSeededSession, pick } from "./session.js";
import { QUERIES, DOC_QUERIES } from "./corpus.js";

const STRESS = __ENV.PROFILE === "stress";

export const options = {
  scenarios: {
    search: {
      executor: "ramping-arrival-rate",
      startRate: STRESS ? 5 : 1,
      timeUnit: "1s",
      preAllocatedVUs: 20,
      maxVUs: STRESS ? 200 : 50,
      stages: STRESS
        ? [
            { target: 5, duration: "30s" },
            { target: 25, duration: "1m" },
            { target: 50, duration: "1m" },
          ]
        : [
            { target: 1, duration: "30s" },
            { target: 5, duration: "30s" },
            { target: 10, duration: "1m" },
          ],
    },
  },
  thresholds: STRESS
    ? {
        http_req_failed: ["rate<0.05"],
        http_req_duration: ["p(95)<10000"],
      }
    : {
        http_req_failed: ["rate<0.01"],
        "http_req_duration{endpoint:knowledge_search}": [
          "p(95)<1500",
          "p(99)<3000",
        ],
        "http_req_duration{endpoint:reference_search}": ["p(95)<1500"],
      },
};

export const setup = setupSeededSession;

export default function (data) {
  const h = headers(data);
  if (Math.random() < 0.7) {
    check(
      http.get(
        `${BASE_URL}/api/knowledge/search?q=${encodeURIComponent(pick(QUERIES))}`,
        { headers: h, tags: { endpoint: "knowledge_search" }, timeout: "60s" },
      ),
      { "knowledge search ok": (r) => r.status === 200 },
    );
  } else {
    check(
      http.get(
        `${BASE_URL}/api/reference/search?q=${encodeURIComponent(pick(DOC_QUERIES))}`,
        { headers: h, tags: { endpoint: "reference_search" }, timeout: "60s" },
      ),
      { "reference search ok": (r) => r.status === 200 },
    );
  }
}
