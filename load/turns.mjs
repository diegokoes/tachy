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
  const res = await admin("/api/users", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD, role: "member" }),
  });
  if (res.ok) return;
  const text = await res.text();
  if (res.status === 400 && /already exists/.test(text)) return;
  throw new Error(`creating ${email}: ${res.status} ${text}`);
}

async function login(email) {
  const res = await fetch(`${BASE}/auth/password/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  if (!res.ok || !cookie) throw new Error(`login ${email}: ${res.status}`);
  return cookie;
}

async function runtime() {
  const res = await admin("/api/system");
  return res.ok ? (await res.json()).runtime : null;
}

async function turn(cookie) {
  const t0 = performance.now();
  const out = { firstEventMs: null, totalMs: null, queued: false, ok: false };
  const res = await fetch(`${BASE}/api/agent/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ message: MESSAGE }),
  });
  if (!res.ok) {
    out.error = `${res.status}`;
    return out;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event: (.*)$/m.exec(frame)?.[1];
      if (!event || event === "start") continue;
      if (event === "queued") out.queued = true;
      else if (out.firstEventMs === null)
        out.firstEventMs = performance.now() - t0;
      if (event === "result") out.ok = true;
      if (event === "error") out.error = /^data: (.*)$/m.exec(frame)?.[1];
    }
  }
  out.totalMs = performance.now() - t0;
  return out;
}

const pct = (xs, p) => {
  const s = xs.filter((x) => x !== null).sort((a, b) => a - b);
  return s.length
    ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))])
    : null;
};

const max = Math.max(...LEVELS);
const emails = Array.from(
  { length: max },
  (_, i) => `${PREFIX}-${String(i + 1).padStart(2, "0")}@tachy.local`,
);
for (const e of emails) await ensureUser(e);
const cookies = [];
for (const e of emails) cookies.push(await login(e));

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
      const r = await runtime().catch(() => null);
      if (r) {
        if (r.memory) peakMem = Math.max(peakMem, r.memory.currentBytes);
        peakSlots = Math.max(peakSlots, r.turns.slotsUsed);
        peakQueued = Math.max(peakQueued, r.turns.queued);
        if (r.postgres.byProcess)
          peakPg = Math.max(
            peakPg,
            r.postgres.byProcess.reduce((s, p) => s + p.n, 0),
          );
      }
      await new Promise((res) => setTimeout(res, 250));
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
      p50: pct(
        turns.map((t) => t.firstEventMs),
        50,
      ),
      p95: pct(
        turns.map((t) => t.firstEventMs),
        95,
      ),
    },
    totalMs: {
      p50: pct(
        turns.map((t) => t.totalMs),
        50,
      ),
      p95: pct(
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
