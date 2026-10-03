import http from "k6/http";
import { check, fail } from "k6";

// Inside the compose network the API answers on its service name and internal
// port; the host-side mapping (8788) is only there for a browser.
export const BASE_URL = __ENV.BASE_URL || "http://api:8787";
const EMAIL = __ENV.LOGIN_EMAIL || "dev-member@tachy.local";
const PASSWORD = __ENV.LOGIN_PASSWORD || "tachy-dev-password";

/**
 * One login for the whole run. The session cookie is a stateless signed
 * `exp|email` HMAC with no server-side store, so every VU can share it -- and
 * must: hashPassword is scrypt at N=16384, so a login per iteration would be
 * a self-inflicted DoS rather than a measurement.
 */
export function login() {
  const res = http.post(
    `${BASE_URL}/auth/password/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { "Content-Type": "application/json" } },
  );
  if (res.status !== 200)
    fail(
      `login failed (${res.status}) for ${EMAIL}. ` +
        `Seed the database first: docker compose -p tachy-dev run --rm cli npm run sync -- seed --scale=medium --reset --yes`,
    );
  const cookie = (res.headers["Set-Cookie"] || "").split(";")[0];
  if (!cookie) fail("login returned no session cookie");
  return cookie;
}

export const headers = (data) => ({ Cookie: data.cookie });

/**
 * The embedding pipeline is built lazily and the model is loaded on first use,
 * so the first search after a container start pays for the whole model load.
 * Without this the p95 is a measurement of one cold start.
 */
export function warmEmbeddings(cookie) {
  http.get(`${BASE_URL}/api/knowledge/search?q=warmup`, {
    headers: { Cookie: cookie },
    timeout: "120s",
    tags: { endpoint: "warmup" },
  });
}

/** Ids the scenarios need, fetched once and shared with every VU. */
export function collectCorpus(cookie) {
  const h = { Cookie: cookie };
  const get = (path) => {
    const res = http.get(`${BASE_URL}${path}`, { headers: h });
    return res.status === 200 ? res.json() : [];
  };
  return {
    knowledgeIds: get("/api/knowledge?limit=100").map((r) => r.id),
    docIds: get("/api/reference?limit=50").map((r) => r.id),
    outputIds: get("/api/outputs").map((r) => r.id),
  };
}

export function setupSession() {
  const cookie = login();
  warmEmbeddings(cookie);
  const corpus = collectCorpus(cookie);
  check(corpus, {
    "seeded knowledge entries exist": (c) => c.knowledgeIds.length > 0,
  });
  return { cookie, ...corpus };
}

export const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
