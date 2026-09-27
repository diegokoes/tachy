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
    "http_req_duration{endpoint:readyz}": ["p(95)<200"],
  },
};

export const setup = setupSession;

export default function (data) {
  const h = headers(data);
  const ok = (name, res) =>
    check(res, { [`${name} is 200`]: (r) => r.status === 200 });

  ok(
    "readyz",
    http.get(`${BASE_URL}/readyz`, { tags: { endpoint: "readyz" } }),
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

  ok(
    "system",
    http.get(`${BASE_URL}/api/system`, {
      headers: h,
      tags: { endpoint: "system" },
    }),
  );
  ok(
    "overview",
    http.get(`${BASE_URL}/api/overview`, {
      headers: h,
      tags: { endpoint: "overview" },
    }),
  );
  ok(
    "overview activity",
    http.get(`${BASE_URL}/api/overview/activity`, {
      headers: h,
      tags: { endpoint: "overview_activity" },
    }),
  );

  const wikis = http.get(`${BASE_URL}/api/library/wiki`, {
    headers: h,
    tags: { endpoint: "wiki_list" },
  });
  ok("wiki list", wikis);
  const withArticles = (wikis.json() || []).find((w) => w.articles > 0);
  const scope = withArticles
    ? withArticles.product_slug || "general"
    : "general";
  for (const [name, path] of [
    ["wiki toc", "toc"],
    ["wiki main", "main"],
    ["wiki categories", "categories"],
    ["wiki gaps", "gaps"],
  ])
    ok(
      name,
      http.get(`${BASE_URL}/api/library/wiki/${scope}/${path}`, {
        headers: h,
        tags: { endpoint: `wiki_${path}` },
      }),
    );

  const toc = http.get(`${BASE_URL}/api/library/wiki/${scope}/toc`, {
    headers: h,
    tags: { endpoint: "wiki_toc" },
  });
  const article = /"articles":\[\{"id":"[^"]+","slug":"([^"]+)"/.exec(
    toc.body || "",
  );
  if (article) {
    const res = http.get(
      `${BASE_URL}/api/library/wiki/${scope}/articles/${article[1]}`,
      { headers: h, tags: { endpoint: "wiki_article" } },
    );
    ok("wiki article", res);
    const asset = /\/api\/library\/assets\/([0-9a-f-]{36})/.exec(
      res.body || "",
    );
    if (asset)
      ok(
        "library image",
        http.get(`${BASE_URL}/api/library/assets/${asset[1]}`, {
          headers: h,
          tags: { endpoint: "library_asset" },
        }),
      );
  }
}
