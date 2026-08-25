import http from "k6/http";
import { check } from "k6";
import { BASE_URL, headers, setupSession, pick } from "./lib/session.js";
import { QUERIES, DOC_QUERIES } from "./lib/corpus.js";

/** One pass over everything the suite covers. Run this after every deploy. */
export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    http_req_failed: ["rate==0"],
    checks: ["rate==1"],
    "http_req_duration{endpoint:health}": ["p(95)<200"],
  },
};

export const setup = setupSession;

export default function (data) {
  const h = headers(data);
  const ok = (name, res) =>
    check(res, { [`${name} is 200`]: (r) => r.status === 200 });

  ok(
    "health",
    http.get(`${BASE_URL}/health`, { tags: { endpoint: "health" } }),
  );
  ok(
    "knowledge list",
    http.get(`${BASE_URL}/api/knowledge?limit=20`, {
      headers: h,
      tags: { endpoint: "knowledge_list" },
    }),
  );
  ok(
    "knowledge facets",
    http.get(`${BASE_URL}/api/knowledge/facets`, {
      headers: h,
      tags: { endpoint: "facets" },
    }),
  );
  ok(
    "knowledge search",
    http.get(
      `${BASE_URL}/api/knowledge/search?q=${encodeURIComponent(pick(QUERIES))}`,
      { headers: h, tags: { endpoint: "knowledge_search" } },
    ),
  );
  ok(
    "reference search",
    http.get(
      `${BASE_URL}/api/reference/search?q=${encodeURIComponent(pick(DOC_QUERIES))}`,
      { headers: h, tags: { endpoint: "reference_search" } },
    ),
  );
  ok(
    "environments",
    http.get(`${BASE_URL}/api/knowledge/environments`, {
      headers: h,
      tags: { endpoint: "environments" },
    }),
  );

  if (data.knowledgeIds.length)
    ok(
      "knowledge detail",
      http.get(`${BASE_URL}/api/knowledge/${pick(data.knowledgeIds)}`, {
        headers: h,
        tags: { endpoint: "knowledge_detail" },
      }),
    );
  if (data.docIds.length)
    ok(
      "reference detail",
      http.get(`${BASE_URL}/api/reference/${pick(data.docIds)}`, {
        headers: h,
        tags: { endpoint: "reference_detail" },
      }),
    );
  if (data.outputIds.length)
    ok(
      "output download",
      http.get(`${BASE_URL}/api/outputs/${pick(data.outputIds)}/download`, {
        headers: h,
        tags: { endpoint: "output_download" },
      }),
    );
}
