import http from "k6/http";
import { check } from "k6";
import { BASE_URL, headers, setupSession, pick } from "./lib/session.js";
import { QUERIES, DOC_QUERIES } from "./lib/corpus.js";

/**
 * A day's traffic in miniature. The weights are placeholders until a week of
 * real traffic replaces them (Admin > system shows the counts): set W_LIST,
 * W_DETAIL, W_SEARCH, W_DOC_SEARCH and W_FACETS to the observed shares.
 */
const weights = [
  ["list", Number(__ENV.W_LIST || 30)],
  ["detail", Number(__ENV.W_DETAIL || 30)],
  ["search", Number(__ENV.W_SEARCH || 25)],
  ["doc_search", Number(__ENV.W_DOC_SEARCH || 10)],
  ["facets", Number(__ENV.W_FACETS || 5)],
];
const total = weights.reduce((n, [, w]) => n + w, 0);

export const options = {
  scenarios: {
    mixed: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE || 10),
      timeUnit: "1s",
      duration: __ENV.DURATION || "5m",
      preAllocatedVUs: 20,
      maxVUs: 80,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{kind:read}": ["p(95)<300"],
    "http_req_duration{kind:search}": ["p(95)<1500"],
  },
};

export const setup = setupSession;

function choose() {
  let roll = Math.random() * total;
  for (const [name, w] of weights) {
    if (roll < w) return name;
    roll -= w;
  }
  return weights[0][0];
}

export default function (data) {
  const h = headers(data);
  const get = (path, endpoint, kind) =>
    check(
      http.get(`${BASE_URL}${path}`, {
        headers: h,
        tags: { endpoint, kind },
        timeout: "60s",
      }),
      {
        [`${endpoint} ok`]: (r) => r.status === 200,
      },
    );
  switch (choose()) {
    case "list":
      return get("/api/knowledge?limit=20", "knowledge_list", "read");
    case "detail":
      return data.knowledgeIds.length
        ? get(
            `/api/knowledge/${pick(data.knowledgeIds)}`,
            "knowledge_detail",
            "read",
          )
        : undefined;
    case "search":
      return get(
        `/api/knowledge/search?q=${encodeURIComponent(pick(QUERIES))}`,
        "knowledge_search",
        "search",
      );
    case "doc_search":
      return get(
        `/api/reference/search?q=${encodeURIComponent(pick(DOC_QUERIES))}`,
        "reference_search",
        "search",
      );
    default:
      return get("/api/knowledge/facets", "facets", "read");
  }
}
