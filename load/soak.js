import http from "k6/http";
import { check } from "k6";
import { BASE_URL, headers, setupSession, pick } from "./lib/session.js";
import { QUERIES } from "./lib/corpus.js";

/**
 * A low, steady mix held for a long time. What this is looking for is not
 * latency: it is RSS growth in the API container (the ONNX session, the
 * in-process turns Map, generated_outputs piling up) and whether the postgres
 * pool still behaves after an hour. Watch `docker stats` alongside it, and
 * check /health still answers at the end.
 */
export const options = {
  scenarios: {
    soak: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE || 2),
      timeUnit: "1s",
      duration: __ENV.DURATION || "30m",
      preAllocatedVUs: 10,
      maxVUs: 40,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<2000"],
  },
};

export const setup = setupSession;

export default function (data) {
  const h = headers(data);
  if (Math.random() < 0.3) {
    check(
      http.get(
        `${BASE_URL}/api/knowledge/search?q=${encodeURIComponent(pick(QUERIES))}`,
        { headers: h, tags: { endpoint: "knowledge_search" }, timeout: "60s" },
      ),
      { "search ok": (r) => r.status === 200 },
    );
  } else if (data.knowledgeIds.length) {
    check(
      http.get(`${BASE_URL}/api/knowledge/${pick(data.knowledgeIds)}`, {
        headers: h,
        tags: { endpoint: "knowledge_detail" },
      }),
      { "detail ok": (r) => r.status === 200 },
    );
  }
}
