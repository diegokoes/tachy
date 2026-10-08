// Concurrent chat turns against an API whose agent points at the mock LLM
// (load/mock-llm/server.mjs). Measures what the admission cap is sized from:
// memory per turn, time to the first event, total turn time, and Postgres
// connections, read from the admin runtime block while the turns run.
//
//   BASE_URL=http://127.0.0.1:8787 TACHY_API_TOKEN=... LEVELS=1,5,10 \
//     node load/turns.mjs
//
// Never run it against a server whose agent talks to a real provider.
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const TOKEN = process.env.TACHY_API_TOKEN;
const LEVELS = (process.env.LEVELS ?? "1,5,10").split(",").map(Number);
const PASSWORD = process.env.LOAD_PASSWORD ?? "load-turns-password";
const PREFIX = process.env.LOAD_USER_PREFIX ?? "load-turn";
const MESSAGE =
  process.env.MESSAGE ?? "The printer queue stalls after a reboot. Why?";

if (!TOKEN) {
  console.error(
    "TACHY_API_TOKEN is required (admin calls and runtime polling)",
  );
  process.exit(2);
}

const admin = (path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });

async function ensureUser(email) {
  const response = await admin("/api/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password: PASSWORD,
      role: "member",
      service_account: true,
      password_login_allowed: true,
    }),
  });
  if (response.ok) return;
  const text = await response.text();
  if (response.status === 400 && /already exists/.test(text)) return;
  throw new Error(`creating ${email}: ${response.status} ${text}`);
}

async function login(email) {
  const response = await fetch(`${BASE}/auth/password/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  if (!response.ok || !cookie)
    throw new Error(`login ${email}: ${response.status}`);
  return cookie;
}

async function runtime() {
  const response = await admin("/api/system");
  return response.ok ? (await response.json()).runtime : null;
}

async function turn(cookie) {
  const startedAt = performance.now();
  const timing = {
    firstEventMs: null,
    totalMs: null,
    queued: false,
    ok: false,
  };
  const response = await fetch(`${BASE}/api/agent/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ message: MESSAGE }),
  });
  if (!response.ok) {
    timing.error = `${response.status}`;
    return timing;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      const event = /^event: (.*)$/m.exec(frame)?.[1];
      if (!event || event === "start") continue;
      if (event === "queued") timing.queued = true;
      else if (timing.firstEventMs === null)
        timing.firstEventMs = performance.now() - startedAt;
      if (event === "result") timing.ok = true;
      if (event === "error") timing.error = /^data: (.*)$/m.exec(frame)?.[1];
    }
  }
  timing.totalMs = performance.now() - startedAt;
  return timing;
}

const percentile = (values, percent) => {
  const sorted = values.filter((x) => x !== null).sort((a, b) => a - b);
  return sorted.length
    ? Math.round(
        sorted[
          Math.min(
            sorted.length - 1,
            Math.floor((percent / 100) * sorted.length),
          )
        ],
      )
    : null;
};

const max = Math.max(...LEVELS);
const emails = Array.from(
  { length: max },
  (_, i) => `${PREFIX}-${String(i + 1).padStart(2, "0")}@tachy.local`,
);
for (const email of emails) await ensureUser(email);
const cookies = [];
for (const email of emails) cookies.push(await login(email));

const results = [];
for (const n of LEVELS) {
  const before = await runtime();
  const baseline = before?.memory?.currentBytes ?? null;
  let peakMem = baseline ?? 0;
  let peakSlots = 0;
  let peakQueued = 0;
  let peakPg = 0;
  let polling = true;
  const poller = (async () => {
    while (polling) {
      const live = await runtime().catch(() => null);
      if (live) {
        if (live.memory) peakMem = Math.max(peakMem, live.memory.currentBytes);
        peakSlots = Math.max(peakSlots, live.turns.slotsUsed);
        peakQueued = Math.max(peakQueued, live.turns.queued);
        if (live.postgres.byProcess)
          peakPg = Math.max(
            peakPg,
            live.postgres.byProcess.reduce((s, p) => s + p.n, 0),
          );
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();

  const turns = await Promise.all(cookies.slice(0, n).map(turn));
  polling = false;
  await poller;

  const summary = {
    concurrent: n,
    ok: turns.filter((t) => t.ok).length,
    queued: turns.filter((t) => t.queued).length,
    errors: turns.filter((t) => t.error).map((t) => t.error),
    firstEventMs: {
      p50: percentile(
        turns.map((t) => t.firstEventMs),
        50,
      ),
      p95: percentile(
        turns.map((t) => t.firstEventMs),
        95,
      ),
    },
    totalMs: {
      p50: percentile(
        turns.map((t) => t.totalMs),
        50,
      ),
      p95: percentile(
        turns.map((t) => t.totalMs),
        95,
      ),
    },
    peakSlotsUsed: peakSlots,
    peakQueued,
    peakPostgresConnections: peakPg,
    memory:
      baseline === null
        ? "no cgroup visible (run inside the container to measure memory)"
        : {
            baselineMiB: Math.round(baseline / 2 ** 20),
            peakMiB: Math.round(peakMem / 2 ** 20),
            perTurnMiB: Math.round((peakMem - baseline) / 2 ** 20 / n),
          },
  };
  results.push(summary);
  console.log(JSON.stringify(summary));
  await new Promise((r) => setTimeout(r, 2000));
}
