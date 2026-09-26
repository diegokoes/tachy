import { insertRows, type Tx } from "./batches";
import { chance, intBetween, pick, rngFor, uuidFor } from "./deterministic";
import type { SeededUser } from "./org";
import type { Volumes } from "./scale";

const HOUR = 3_600_000;

/**
 * A cron line and the same schedule as a step, so the history can be laid on
 * the slots the scheduler would really have fired without pulling croner into
 * the CLI. Only the shapes used below: every N hours at a minute, from an hour.
 */
interface Slots {
  cron: string;
  everyHours: number;
  firstHour: number;
  minute: number;
}
const hourly = (minute: number): Slots => ({
  cron: `${minute} * * * *`,
  everyHours: 1,
  firstHour: 0,
  minute,
});
const everyHours = (n: number, minute: number): Slots => ({
  cron: `${minute} */${n} * * *`,
  everyHours: n,
  firstHour: 0,
  minute,
});
const daily = (hour: number, minute: number): Slots => ({
  cron: `${minute} ${hour} * * *`,
  everyHours: 24,
  firstHour: hour,
  minute,
});

function slotsSince(s: Slots, days: number, now: Date): Date[] {
  const start = new Date(now.getTime() - days * 24 * HOUR);
  start.setUTCHours(s.firstHour, s.minute, 0, 0);
  const out: Date[] = [];
  for (let t = start.getTime(); t <= now.getTime(); t += s.everyHours * HOUR)
    if (t > now.getTime() - days * 24 * HOUR) out.push(new Date(t));
  return out;
}

type Params = Record<string, string | number | boolean>;

type Outcome = "succeeded" | "failed" | "cancelled" | "timed_out";

/** What one kind's runs look like: how long they take, how they go wrong. */
interface KindProfile {
  resourceClass: "light" | "heavy";
  timeoutMs: number;
  maxAttempts: number;
  seconds: [number, number];
  outcome(rng: () => number): Outcome;
  output(
    rng: () => number,
    params: Params,
  ): Record<string, string | number | boolean>;
  errors: string[];
  log(params: Params): string;
}

const PROFILES: Record<string, KindProfile> = {
  "wiki.gaps": {
    resourceClass: "light",
    timeoutMs: 30 * 60_000,
    maxAttempts: 1,
    seconds: [2, 25],
    outcome: (rng) => (chance(rng, 0.97) ? "succeeded" : "failed"),
    output: (rng) => ({
      wikis: intBetween(rng, 2, 4),
      skipped: 0,
      failed: 0,
      gaps: intBetween(rng, 6, 40),
    }),
    errors: ["canceling statement due to lock timeout"],
    log: () => "sweeping wikis\nsweep done",
  },
  "retention.sweep": {
    resourceClass: "light",
    timeoutMs: 60 * 60_000,
    maxAttempts: 1,
    seconds: [4, 70],
    outcome: () => "succeeded",
    output: (rng) => ({
      outputs: intBetween(rng, 0, 12),
      uploads: intBetween(rng, 0, 30),
      job_runs: intBetween(rng, 0, 200),
      transcripts: intBetween(rng, 0, 80),
      assets: intBetween(rng, 0, 5),
      usage: intBetween(rng, 0, 3),
    }),
    errors: [],
    log: () => "retention applied",
  },
  "source.sync": {
    resourceClass: "light",
    timeoutMs: 60 * 60_000,
    maxAttempts: 3,
    seconds: [15, 420],
    outcome: (rng) => (chance(rng, 0.88) ? "succeeded" : "failed"),
    output: (rng) => ({
      items: intBetween(rng, 0, 140),
      since: new Date(Date.now() - intBetween(rng, 1, 6) * HOUR).toISOString(),
    }),
    errors: [
      "401 Unauthorized: the connection's token was rejected",
      "429 Too Many Requests: rate limited, retry after 60s",
      "fetch failed: getaddrinfo ENOTFOUND",
      "502 Bad Gateway from the source API",
    ],
    log: (p) => `syncing ${p.connection}\nfetching changed work items`,
  },
  "repo.reindex": {
    resourceClass: "heavy",
    timeoutMs: 2 * HOUR,
    maxAttempts: 1,
    seconds: [180, 1500],
    outcome: (rng) =>
      chance(rng, 0.9)
        ? "succeeded"
        : chance(rng, 0.5)
          ? "timed_out"
          : "failed",
    output: (rng, p) => {
      const files = intBetween(rng, 150, 400);
      return {
        slug: p.repo,
        indexedCommit: Math.floor(rng() * 0xfffffff)
          .toString(16)
          .padStart(7, "0"),
        upToDate: chance(rng, 0.3),
        filesIndexed: intBetween(rng, 0, 40),
        filesDeleted: intBetween(rng, 0, 4),
        fileCount: files,
        chunkCount: files * intBetween(rng, 3, 5),
      };
    },
    errors: [
      "git fetch failed: remote: Repository not found.",
      "embedding model failed to load 3 times",
    ],
    log: (p) => `indexing ${p.repo}`,
  },
  "embeddings.backfill": {
    resourceClass: "heavy",
    timeoutMs: 6 * HOUR,
    maxAttempts: 1,
    seconds: [300, 2400],
    outcome: (rng) => (chance(rng, 0.8) ? "succeeded" : "cancelled"),
    output: (rng) => ({
      entries: intBetween(rng, 0, 150),
      chunks: intBetween(rng, 0, 400),
      code: intBetween(rng, 0, 900),
    }),
    errors: [],
    log: () => "embedding missing vectors",
  },
};

interface Definition {
  id: string;
  kind: string;
  name: string;
  params: Params;
  enabled: boolean;
  slots: Slots | null;
}

/**
 * Job definitions for every kind core ships and the run history their
 * schedules would have left, so the workers page, the failures panel and the
 * next-24h preview all have something to show on a fresh database. The API's
 * default definitions are created here under the same names, so it does not add
 * a second copy at start.
 */
export async function seedJobs(
  tx: Tx,
  v: Volumes,
  users: SeededUser[],
  connections: { slug: string }[],
): Promise<void> {
  const now = new Date();
  const admins = users.filter((u) => u.role === "admin");
  const admin = admins[0] ?? users[0];
  const repos = Array.from({ length: v.repos }, (_, i) => `seed-repo-${i}`);

  let n = 0;
  const def = (d: Omit<Definition, "id">): Definition => ({
    ...d,
    id: uuidFor("job-definition", n++),
  });
  const definitions: Definition[] = [
    def({
      kind: "wiki.gaps",
      name: "Find wiki gaps",
      params: {},
      enabled: true,
      slots: hourly(7),
    }),
    def({
      kind: "retention.sweep",
      name: "Apply retention",
      params: { transcript_days: 90, usage_months: 13 },
      enabled: true,
      slots: daily(3, 30),
    }),
    ...connections.map((c, i) =>
      def({
        kind: "source.sync",
        name: `Sync ${c.slug}`,
        params: { connection: c.slug },
        enabled: true,
        slots: everyHours(3, 20 + i * 5),
      }),
    ),
    ...repos.map((slug, i) =>
      def({
        kind: "repo.reindex",
        name: `Reindex ${slug}`,
        params: { repo: slug },
        enabled: true,
        slots: daily(2, i * 15),
      }),
    ),
    def({
      kind: "embeddings.backfill",
      name: "Embed missing vectors",
      params: { all: false },
      enabled: true,
      slots: null,
    }),
    def({
      kind: "source.sync",
      name: "Sync legacy-helpdesk",
      params: { connection: "legacy-helpdesk" },
      enabled: false,
      slots: null,
    }),
  ];

  const created = new Date(now.getTime() - (v.jobHistoryDays + 5) * 24 * HOUR);
  const runs: Record<string, unknown>[] = [];
  const lastSlot = new Map<string, Date>();
  let r = 0;

  const addRun = (
    d: Definition,
    at: Date,
    trigger: "schedule" | "manual",
    rng: () => number,
  ) => {
    const p = PROFILES[d.kind];
    const outcome = p.outcome(rng);
    const attempts =
      outcome === "failed" && p.maxAttempts > 1 ? p.maxAttempts : 1;
    const started = new Date(at.getTime() + intBetween(rng, 1, 20) * 1000);
    const seconds =
      outcome === "timed_out"
        ? p.timeoutMs / 1000
        : outcome === "cancelled"
          ? intBetween(rng, 30, p.seconds[0])
          : intBetween(rng, p.seconds[0], p.seconds[1]);
    const finished = new Date(started.getTime() + seconds * 1000);
    if (finished > now) return;
    const error =
      outcome === "failed"
        ? pick(rng, p.errors.length ? p.errors : ["unexpected error"])
        : outcome === "timed_out"
          ? `timed out after ${p.timeoutMs / 60_000} min`
          : outcome === "cancelled"
            ? "cancelled by an admin"
            : null;
    runs.push({
      id: uuidFor("job-run", r++),
      definition_id: d.id,
      kind: d.kind,
      params: tx.json(d.params),
      resource_class: p.resourceClass,
      trigger,
      scheduled_for: trigger === "schedule" ? at : null,
      requested_by:
        trigger === "manual"
          ? pick(rng, admins.length ? admins : users).id
          : null,
      status: outcome,
      attempts,
      max_attempts: p.maxAttempts,
      timeout_ms: p.timeoutMs,
      run_after: at,
      progress: outcome === "succeeded" ? 1 : Number(rng().toFixed(2)),
      output: outcome === "succeeded" ? tx.json(p.output(rng, d.params)) : null,
      error,
      log_tail: error ? `${p.log(d.params)}\n${error}` : p.log(d.params),
      created_at: at,
      started_at: started,
      finished_at: finished,
    });
  };

  for (const d of definitions) {
    if (!d.slots || !d.enabled) continue;
    const slots = slotsSince(d.slots, v.jobHistoryDays, now);
    slots.forEach((at, i) =>
      addRun(d, at, "schedule", rngFor(`job-${d.name}`, i)),
    );
    if (slots.length) lastSlot.set(d.id, slots[slots.length - 1]);
  }

  // Someone re-runs a sync after fixing its token, or kicks a backfill after a
  // model change: runs outside any schedule, started by an admin.
  const manual = definitions.filter((d) => d.enabled);
  for (let i = 0; i < v.jobManualRuns; i++) {
    const rng = rngFor("job-manual", i);
    const d =
      i % 3 === 0
        ? definitions.find((x) => x.kind === "embeddings.backfill")!
        : pick(rng, manual);
    const at = new Date(
      now.getTime() - Math.floor(rng() * v.jobHistoryDays * 24 * HOUR),
    );
    addRun(d, at, "manual", rng);
  }

  await insertRows(
    tx,
    "job_definitions",
    [
      "id",
      "kind",
      "name",
      "params",
      "enabled",
      "schedule",
      "last_scheduled_for",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at",
    ],
    definitions.map((d) => ({
      id: d.id,
      kind: d.kind,
      name: d.name,
      params: tx.json(d.params),
      enabled: d.enabled,
      schedule: d.slots?.cron ?? null,
      last_scheduled_for: lastSlot.get(d.id) ?? null,
      created_by: admin.id,
      updated_by: admin.id,
      created_at: created,
      updated_at: d.enabled ? created : new Date(now.getTime() - 2 * 24 * HOUR),
    })),
  );

  await insertRows(
    tx,
    "job_runs",
    [
      "id",
      "definition_id",
      "kind",
      "params",
      "resource_class",
      "trigger",
      "scheduled_for",
      "requested_by",
      "status",
      "attempts",
      "max_attempts",
      "timeout_ms",
      "run_after",
      "progress",
      "output",
      "error",
      "log_tail",
      "created_at",
      "started_at",
      "finished_at",
    ],
    runs,
  );

  // The change log: every definition created, one schedule edited, and the
  // disabled sync switched off.
  const changes: Record<string, unknown>[] = definitions.map((d, i) => ({
    id: uuidFor("job-definition-change", i),
    definition_id: d.id,
    changed_by: admin.id,
    action: "created",
    old_value: null,
    new_value: tx.json({ kind: d.kind, name: d.name, params: d.params }),
    created_at: created,
  }));
  const sync = definitions.find((d) => d.kind === "source.sync" && d.enabled);
  if (sync)
    changes.push({
      id: uuidFor("job-definition-change", changes.length),
      definition_id: sync.id,
      changed_by: admin.id,
      action: "updated",
      old_value: tx.json({ schedule: "20 */6 * * *" }),
      new_value: tx.json({ schedule: sync.slots?.cron }),
      created_at: new Date(created.getTime() + 24 * HOUR),
    });
  for (const d of definitions.filter((x) => !x.enabled))
    changes.push({
      id: uuidFor("job-definition-change", changes.length),
      definition_id: d.id,
      changed_by: admin.id,
      action: "disabled",
      old_value: tx.json({ enabled: true }),
      new_value: tx.json({ enabled: false }),
      created_at: new Date(now.getTime() - 2 * 24 * HOUR),
    });
  await insertRows(
    tx,
    "job_definition_changes",
    [
      "id",
      "definition_id",
      "changed_by",
      "action",
      "old_value",
      "new_value",
      "created_at",
    ],
    changes,
  );
}
