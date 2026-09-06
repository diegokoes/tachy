import http from "k6/http";
import { check } from "k6";
import { BASE_URL, headers, setupSession, pick } from "./lib/session.js";

/**
 * The read paths a person actually clicks through. Arrival rate rather than a
 * fixed VU count, so a slow server shows up as a growing queue instead of
 * quietly throttling the load to whatever it can manage.
 */
export const options = {
  scenarios: {
    browse: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE || 20),
      timeUnit: "1s",
      duration: __ENV.DURATION || "2m",
      preAllocatedVUs: 20,
      maxVUs: 60,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{endpoint:health}": ["p(95)<50"],
    "http_req_duration{endpoint:knowledge_detail}": ["p(95)<150"],
    "http_req_duration{endpoint:knowledge_list}": ["p(95)<400"],
    // Loosest budget on purpose: facets runs several counting queries over the
    // same filter set.
    "http_req_duration{endpoint:facets}": ["p(95)<600"],
    // A bytea streamed out of Postgres and back through Node.
    "http_req_duration{endpoint:output_download}": ["p(95)<800"],
  },
};

export const setup = setupSession;

export default function (data) {
  const h = headers(data);
  const roll = Math.random();

  if (roll < 0.1) {
    check(http.get(`${BASE_URL}/health`, { tags: { endpoint: "health" } }), {
      "health ok": (r) => r.status === 200,
    });
  } else if (roll < 0.45) {
    const offset = Math.floor(Math.random() * 200);
    check(
      http.get(`${BASE_URL}/api/knowledge?limit=20&offset=${offset}`, {
        headers: h,
        tags: { endpoint: "knowledge_list" },
      }),
      { "list ok": (r) => r.status === 200 },
    );
  } else if (roll < 0.6) {
    check(
      http.get(`${BASE_URL}/api/knowledge/facets`, {
        headers: h,
        tags: { endpoint: "facets" },
      }),
      { "facets ok": (r) => r.status === 200 },
    );
  } else if (roll < 0.9 && data.knowledgeIds.length) {
    check(
      http.get(`${BASE_URL}/api/knowledge/${pick(data.knowledgeIds)}`, {
        headers: h,
        tags: { endpoint: "knowledge_detail" },
      }),
      { "detail ok": (r) => r.status === 200 },
    );
  } else if (data.outputIds.length) {
    check(
      http.get(`${BASE_URL}/api/outputs/${pick(data.outputIds)}/download`, {
        headers: h,
        tags: { endpoint: "output_download" },
      }),
      { "download ok": (r) => r.status === 200 },
    );
  }
}
