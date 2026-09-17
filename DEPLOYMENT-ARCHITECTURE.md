# tachý deployment architecture

Reviewed against `dev` @ `ffad655`, plus the uncommitted working tree, on
2026-09-16. File references point at that tree. Where a claim depends on a third party's behaviour, the source is
linked or the claim is marked **to verify**.

## 1. Scope

How tachý is deployed, operated and grown. There are three profiles:

- **A. Office laptop.** Lenovo ThinkPad E14 Gen 2, Intel i7-1165G7 (4 cores, 8
  threads), **16 GB RAM**, 512 GB NVMe, Debian 13, running now.
- **B. Department server.** A dedicated host for Postgres, one for the
  application, and one for operations.
- **C. Higher availability.** Two application hosts and a Postgres standby.

This is an architecture document, not an implementation spec. Every item in §13
becomes its own pull request. Decisions already taken:

- Docker Compose on every profile up to and including B. No Kubernetes.
- Postgres is the only stateful service. No Redis, no MinIO.
- No metrics stack: no Prometheus, Grafana, Loki or exporters. The admin page
  shows the application's own state, a host watch script raises alerts in
  Teams, and an external heartbeat covers the host dying (§8).
- The dev stack doesn't run on the office laptop. The laptop's 16 GB go to
  production.
- `db/schema.sql` remains the only schema source. Upgrades become a
  declarative diff against it, with no migration files.
- GitHub Actions builds the image once. The host pulls it by commit.
- Backups are encrypted on the host. Team members download them now and then
  to their Windows laptops over read-only SFTP. No cloud storage for now.

## 2. The system as built

### 2.1 Processes

```text
api container (npm run api -> tsx -> packages/api/src/index.ts)
|-- Hono: REST, SPA, SSE
|-- embedding model (bge-base, 417 MB), loaded on first search
|-- repo indexer, when POST /api/repos/:slug/reindex runs it
|-- timers: turn sweep (60 s), generated-output sweep (1 h),
|           wiki gap sweep (at boot, then 1 h)
`-- one tree per chat turn:
    Claude Code CLI (agent SDK query())  or  Copilot runtime (CopilotClient)
    `-- MCP server: node --import tsx packages/mcp/src/index.ts
        |-- its own postgres.js pool (default max 10)
        `-- its own copy of the embedding model, on first search

postgres container (pgvector/pgvector:pg16)
cli container (profile "tools", ad hoc: sync, backup, restore, index-repo, seed)
```

- A turn starts at `POST /api/agent/chat` (`packages/api/src/routes/agent.ts:290`).
  The Claude backend calls `query()` (`packages/agent/src/claude.ts:185`). The
  Copilot backend constructs a `CopilotClient` per turn
  (`packages/agent/src/copilot.ts:79`). Both are handed the MCP server as a
  stdio command (`routes/agent.ts:150-152`).
- The MCP child imports `@tachy/core`. That opens a postgres.js pool with no
  options (`packages/core/src/infra/db.ts:6`). postgres.js defaults to `max: 10`
  and `idle_timeout: 0` (its README, "Connection details").
- Each process that embeds loads its own copy of the model. `test/parallel.ts:10`
  measures one copy at 417 MB.
- Query embeddings run in whichever process serves the search. Knowledge saves
  embed inside the request (`packages/core/src/knowledge/knowledge.ts:215`),
  and so do reference saves, every chunk (`packages/core/src/reference/reference.ts:112`).
  Repo reindexing runs fire-and-forget inside the API (`routes/repos.ts:178`).
  Per `load/README.md`, the model "saturates the cores it is given".
- `sync` (source ingestion) exists only as a CLI command. Nothing schedules it.
- The wiki gap sweep runs inside the API (`packages/api/src/index.ts:55`). It
  runs once per process, so a second replica runs it twice.
- Usage counting writes to Postgres without waiting for the write: library
  views (`library_views`), tool calls from each MCP child (`mcp_tool_calls`,
  `mcp/src/server.ts`) and source traffic (`source_calls`,
  `core/src/sources/traffic.ts`). All of them go through `inBackground`
  (`core/src/infra/background.ts`). Neither the API nor the MCP child waits on
  `backgroundSettled` before it exits, so a count still in flight at shutdown
  is lost. That is acceptable for counts, but it should be a stated choice.

### 2.2 Where state lives

| State                      | Location                                                                                                | Durable?                          | With two API replicas                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------- |
| System of record           | Postgres volume                                                                                         | yes                               | fine                                                                                     |
| Generated exports          | `generated_outputs.bytes` in Postgres, TTL 24 h, hourly sweep (`routes/outputs.ts:13`)                  | until TTL                         | fine; the sweep is idempotent                                                            |
| Library images             | `library_assets.bytes` in Postgres, deduplicated by sha256, 5 MB cap (`contract/src/assets.ts`)         | yes; nothing removes orphans      | fine                                                                                     |
| Usage counters             | `library_views`, `mcp_tool_calls`, `source_calls`, bucketed by day                                      | yes; no retention                 | fine; upserts                                                                            |
| Wiki gaps                  | `wiki_gaps`, refreshed by the hourly sweep                                                              | yes                               | fine, but every replica runs the sweep                                                   |
| Chat uploads               | `os.tmpdir()/tachy-uploads` (`core/src/infra/env.ts:107`); the Dockerfile never sets `TACHY_UPLOAD_DIR` | no; lost on recreate, never swept | **breaks**: the upload and the chat can hit different replicas (`mcp/src/extract.ts:33`) |
| Active turns and approvals | in-process `Map` (`routes/agent.ts:44`); approval resolvers in `TurnBase` (`agent/src/turn.ts`)         | no; a restart kills them          | **breaks**: `/approve` must reach the owning process                                     |
| Claude session transcripts | `tachy-agent-home` volume, `users/<id>`                                                                 | yes                               | **breaks** `resume` unless shared or routed sticky by user                               |
| Copilot session state      | inside the container, not on a volume (SDK path **to verify**)                                          | no                                | breaks `resume`                                                                          |
| Login throttle             | `Map` (`api/src/auth.ts:123`)                                                                           | no                                | weakens to per replica                                                                   |
| Permission cache           | 60 s `Map` (`core/src/access/permissions.ts:15`)                                                        | no                                | a role change is stale for up to 60 s on the other replicas                              |
| Reindex guard              | `Set` (`routes/repos.ts:58`)                                                                            | no                                | two replicas can index one repo at once                                                  |
| Repo clones                | `tachy-repo-data` volume                                                                                | rebuildable cache                 | per host                                                                                 |
| Embedding model            | image layer (`/app/.model-cache`)                                                                       | rebuildable                       | fine                                                                                     |
| Container logs             | Docker `json-file`, no rotation configured                                                              | grows without bound               | —                                                                                        |
| Backups                    | `./backups` bind mount, same disk                                                                       | not off-host                      | —                                                                                        |

### 2.3 How it is deployed today

- The laptop checkout is `/opt/tachy`. `tachy-deploy [branch]` hard-resets it
  to `origin/<branch>` and builds `tachy:local` on the laptop.
- The `Jenkinsfile` pushes `:latest` and `:dev` to Docker Hub, and deploys over
  SSH to `tachy@office-laptop.local` (`Jenkinsfile:6`). Its production stage runs
  `compose pull && up -d api` without updating the checkout, so
  `docker-compose.yml` and `db/schema.sql` on the host can drift from the
  image. It is not in use.
- GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, `web:check` and
  `coverage` on pull requests and on pushes to `main`. Pushes to `dev` aren't
  built. On pull requests it also bundles the k6 scripts with
  `grafana/k6:latest`, without running them.
- A second, dev stack shares the laptop's CPU and RAM (README, Deployment).
- The API publishes `0.0.0.0:8787` over plain HTTP. Postgres binds to
  `127.0.0.1`.

### 2.4 What fails first

HTTP throughput is not on this list. Thirty people generate a few requests a
second.

1. **RAM, from concurrent turns.** Nothing caps them, and each one is a CLI
   process, an MCP child and possibly a model copy. A Node diagnostic report
   from a developer machine (`report.20260911.005018.52770.0.001.json`) shows a Copilot runtime dying at its 4 GB heap limit,
   with 4.7 GB RSS. The report was never committed and has since been deleted, so
   keep a copy with the capacity notes if it matters.
2. **CPU, from embeddings.** Query embedding, knowledge and reference saves,
   and whole-repo indexing all compete in the API process.
3. **Postgres connections.** The API pool (10), up to 10 more per turn, and the
   CLI's 10 all draw on the default `max_connections` of 100. All of them
   connect as superuser.
4. **Disk.** Unrotated logs, dumps on the same disk, and a 12 GB `/var`
   partition that holds containerd's root.
5. **Silent failure.** `/health` runs only `select 1` (`api/src/app.ts:68`).
   Docker restart policies act on exit, not health: "Restart the container if
   it exits due to an error"
   ([docs](https://docs.docker.com/engine/containers/start-containers-automatically/)).
   There are no metrics and no alert delivery.
6. **Deploys.** Nothing handles SIGTERM, npm is PID 1 (`Dockerfile:74`), and the
   Compose grace period defaults to 10 s, so a redeploy SIGKILLs in-flight
   turns.

## 3. Capacity model (profile A)

The laptop has 16 GB (15.3 GiB usable) and 8 threads. Nothing else runs on it:
no dev stack and no metrics stack. Chat turns are bounded by memory, not CPU,
since a turn spends most of its time waiting on the model provider.

### 3.1 What a turn costs, measured

Measured 2026-09-17 on the workstation, pinned to 8 CPUs to match the laptop.
Claude Code ran against a mock Anthropic API (`ANTHROPIC_BASE_URL`), and each
turn made one `search_knowledge` call through the real MCP server against a
real database. The figures are the peak RSS of the whole process tree, sampled
every 250 ms.

| Process in one turn                     | Today (tsx, own model) | Model moved out | Model moved out, compiled |
| --------------------------------------- | ---------------------: | --------------: | ------------------------: |
| Claude Code CLI (agent SDK 0.3.205)     |                 262 MB |          262 MB |                    262 MB |
| MCP child before its first search       |                 255 MB |          255 MB |                    125 MB |
| MCP child after its first search        |            **1116 MB** |          255 MB |                    125 MB |
| **Turn total**                          |           **~1380 MB** |     **~520 MB** |               **~390 MB** |
| MCP child start (spawn to `initialize`) |                 430 ms |          430 ms |                    181 ms |

- Four turns at once measured 5501 MB, which is 4 × 1375 MB. The cost is
  linear, and there is nothing shared to amortise.
- Importing `@tachy/core` under tsx costs 236 MB. The same code bundled by
  esbuild costs 125 MB for the whole child.
- The embedding model accounts for about 880 MB of each child once it has
  searched (weights plus ONNX runtime arenas), and every turn searches.
- The Claude Code figure comes from a short conversation. It grows with context
  and tool results, so the budget below assumes 400 MB.
- **Copilot turns are unmeasured.** A developer report showed its runtime at
  4.7 GB. Until `turns.js` measures one, a Copilot turn counts as 4 slots.

**The model itself,** measured the same way (8 CPUs, in one process):

| Work                             | Time    | Longest event-loop block | RSS after (from 770 MB warm) |
| -------------------------------- | ------- | -----------------------: | ---------------------------: |
| 1 query                          | 11 ms   |                     0 ms |                            — |
| 20 queries, concurrently         | 212 ms  |                     0 ms |                            — |
| 64 long passages, batches of 32  | 7.4 s   |                **3.7 s** |                  **1653 MB** |
| 64 long passages, batches of 16  | 7.6 s   |                    1.9 s |                      1173 MB |
| 64 long passages, batches of 8   | 7.3 s   |                    0.9 s |                       960 MB |
| 1 query while a batch of 32 runs | 3704 ms |                        — |                            — |

- Queries are cheap. Passages are not, and the cost is in how they're batched.
- `embedPassages` batches 32 at a time (`search/embeddings.ts`). On 8 threads,
  batches of 8 are just as fast, hold the event loop for a quarter as long, and
  use 700 MB less, because the ONNX arena grows to fit the largest batch and
  never shrinks.

**Batch size on the laptop itself,** 256 passages per run, in a throwaway
container from the production image (`--network none`, no database), measured
2026-09-17:

| Texts                           | Batch | Throughput  | Longest block | Arena growth |
| ------------------------------- | ----: | ----------- | ------------: | -----------: |
| short (code chunks, ~350 chars) |     8 | **13.4 /s** |    **664 ms** |   **+80 MB** |
| short                           |    16 | 11.6 /s     |       2280 ms |      +175 MB |
| short                           |    32 | 10.7 /s     |       3085 ms |      +383 MB |
| long (2000 chars, the maximum)  |     8 | **5.0 /s**  |   **1625 ms** |  **+270 MB** |
| long                            |    16 | 3.8 /s      |       5646 ms |      +537 MB |
| long                            |    32 | 4.0 /s      |       7978 ms |     +1088 MB |

- On the laptop, batch 8 was also the fastest, not merely as fast.
- An earlier laptop run of the same test, rounded to whole texts per second,
  had long passages at 3/s for batch 8 against 4/s for batch 32. Laptop timings
  vary by up to about 25% between runs, most likely with temperature, so read
  the throughput column as "no worse". The block and memory columns scale
  cleanly with batch size in every run.
- The laptop embeds at about 65% of the workstation's rate: roughly 13 code
  chunks or 5 long passages a second.
- A passage batch holds the calling thread's event loop for its whole run
  (measured, not inferred from the library). It therefore freezes the process
  that runs it: today a repo reindex or a
  reference save inside the API stalls every HTTP request for seconds at a
  time.

**Conclusion.** Today the laptop can hold about 5 turns before it runs out of
memory, and nothing stops a sixth. Taking the model out of the MCP child is the
change that makes more than 6 possible, so it moves into Phase 1 (§5.4). It
has to move to a worker thread, not onto the API's event loop.

### 3.2 Memory budget

| Memory (GB)                                                     | Phase 1 |
| --------------------------------------------------------------- | ------: |
| OS, Docker, journald, page-cache floor                          |     1.5 |
| postgres (`shared_buffers` 1 GB; the database is 148 MB)        |     2.0 |
| caddy                                                           |     0.1 |
| api: Hono, plus the model in a worker thread, batches of 8      |     1.5 |
| backup and weekly restore test (a scratch Postgres, night only) |     0.6 |
| headroom (the kernel, bursts, a deploy overlapping a drain)     |     1.1 |
| **left for turns**                                              | **8.5** |

| Per turn, budgeted                   |         GB |
| ------------------------------------ | ---------: |
| Claude Code, allowing for long chats |       0.40 |
| MCP child, compiled, no model        |       0.15 |
| **Per Claude turn**                  |   **0.55** |
| **Global cap**                       | **15 now** |

**Admission.**

- The global cap starts at **15** Claude turns (8.5 ÷ 0.55), with **1 per
  user** (§5.5).
- `turns.js` then runs on the laptop itself, in a load window (§11.1), with
  realistic tool results. If the p95 per-turn peak stays under 0.45 GB, the cap
  goes to 18. If the api container ever passes 85% of its limit, the cap drops.
- Copilot turns count as 4 slots until they are measured.
- The cap counts slots, not turns, and it lives in one setting, so it can be
  changed without a deploy.

**Beyond 15–18 turns: more RAM, not a shared MCP server.**

- The laptop has one DDR4 SO-DIMM slot, holding a single 16 GB module
  (`dmidecode`: Samsung M471A2K43EB1, DDR4-3200), and no soldered memory.
  Lenovo lists "Up to 32GB DDR4-3200" and "One DDR4 SO-DIMM slot"
  ([PSREF](https://psref.lenovo.com/syspool/Sys/PDF/ThinkPad/ThinkPad_E14_Gen_2_Intel/ThinkPad_E14_Gen_2_Intel_Spec.pdf)).
- Replacing it with one 32 GB DDR4-3200 SO-DIMM leaves about 24 GB for turns,
  which is about **40 turns** at 0.55 GB. It's a module swap, not a project.
- A shared MCP server would save only the compiled child, 0.15 GB per turn,
  which is about 6 more turns on 16 GB. It was reviewed and rejected (§5.12).

**Expected demand:** 30 users × ~10 turns a day gives about 60 turns in the
peak hour. At ~2 minutes per turn that averages 2 concurrent, with bursts of
5–6. A cap of 15 leaves room for a whole team starting chats at once after a
meeting. Confirm the real peak once `turns` has start and end timestamps.
`analysis_runs` records only the finished result.

**Swap.** 976 MB of swap is a cushion, not capacity. The api container's
`mem_limit` is the backstop: if turns overrun their budget, the kernel OOM-kills
inside that container, and Postgres survives.

### 3.3 CPU

Measured: under sustained all-core load the i7-1165G7 holds 89 °C and keeps
about 90% of its peak frequency (§15.1).

- `postgres` and `api` get high `cpu_shares`.
- Embedding runs in one worker thread in the API: queries first, passages in
  batches of 8 between them, so a search never waits behind more than one
  batch: about 0.7 s behind code chunks and up to about 1.6 s behind the
  longest passages on the laptop. A burst of searches from 15 turns costs about
  11 ms each.
- Repo reindexing and backfills get `nice` and a cap of 4 threads (Phase 2: the
  worker gets `cpus: 4`).

### 3.4 Disk

Alert at 80% on every mount separately.

- `/var` (12 G, 40% used) holds containerd's image layers. Keep the last three
  releases and prune the rest.
- `/srv` (432 G, 2% used) holds Postgres, repo clones, dump staging and the
  backup export. At a 52 MB dump, backups are negligible.

## 4. Topology

### 4.1 Profile A: laptop

```text
Phase 1 (hardened, one api)

LAN/VPN --443--> caddy --> api --+--> postgres
                                 +--> embed worker thread (one model, queries first)
                                 `--> turn trees (cap 15) --> MCP child
                                        MCP child --HTTP--> api embed queue
                                        MCP child ---------> postgres
host timers: backup -> age -> /srv/tachy/backup-export <-sftp- team laptops
             tachy-watch (every minute) -> Teams webhook
             heartbeat -> external check

Phase 2 (separated)

LAN/VPN --443--> caddy --> api --+--> embedder (one model)
                                 +--> postgres <-- worker (jobs; embeds via
                                 |                         embedder, low priority)
                                 `--> turn trees --> MCP --> embedder, postgres
```

### 4.2 Services and replicas

| Service    | A · Phase 1       | A · Phase 2    | B · server         | C · HA                          |
| ---------- | ----------------- | -------------- | ------------------ | ------------------------------- |
| caddy      | 1                 | 1              | 1                  | 1 per app host, behind a VIP    |
| api        | 1 (runs turns)    | 1 (runs turns) | 2, stateless       | 2+ across hosts                 |
| agent      | —                 | —              | 1–2                | 1+ per app host, sticky by user |
| embedder   | — (queue in api)  | 1              | 1–2                | 1 per app host                  |
| worker     | — (api and cli)   | 1              | 1–2                | 1+, cron under a leader lock    |
| postgres   | 1                 | 1              | 1, on its own host | primary and standby             |
| monitoring | host watch script | same           | same, per host     | same, per host                  |

### 4.3 Phase 1 limits on the laptop (starting values)

Set with Compose's service attributes: `mem_limit`, `cpus`, `cpu_shares` and
`pids_limit`.

| Service  | mem_limit | CPU                   | pids_limit | Other                                                |
| -------- | --------- | --------------------- | ---------- | ---------------------------------------------------- |
| caddy    | 256m      | 1024 shares           | 256        | the only published ports, 80 and 443                 |
| api      | 10g       | 2048 shares, no cap   | 2048       | `init: true`, `stop_grace_period` = drain + 30 s     |
| postgres | 2g        | 2048 shares           | —          | `shm_size: 1gb`, tuned conf (§5.9)                   |
| tester   | 512m      | 256 shares, `cpus: 2` | 256        | Phase 2, and only while a load run is active (§11.3) |

The api limit is 1.3 GB of its own plus 8.5 GB of turns. `pids_limit` rises to
2048 because 15 turn trees each hold dozens of threads.

### 4.4 Profile B: department server

- **Application host (Compose):** caddy, api ×2, agent, embedder, worker.
- **Database host:** Postgres and pgBackRest.
- **Monitoring:** the same watch script on each host. A metrics stack is
  reconsidered here only if several hosts make per-host scripts unmanageable.
- **Backups:** a pgBackRest repository on separate storage. Team laptops keep
  pulling the encrypted dumps (§6.2) until a cloud or NAS target exists.

**Portability.** If "more professional" turns out to mean a cloud VM, the same
images run on any Docker host. Managed Postgres works if the service offers
`vector`, `pg_trgm` and `pgcrypto` (**to verify** on the chosen service), and
then only `DATABASE_URL` changes. The hard constraint is the turn process tree:
turns spawn subprocesses and need roughly 0.4–0.6 GB each once the model is
out of the MCP child (§3.1). That rules out
serverless functions. VMs, and container platforms that allow process spawning,
are fine.

### 4.5 Profile C: higher availability

Only worth it when downtime during maintenance or a hardware failure is
genuinely expensive. Requirements:

- two application hosts behind a keepalived VIP;
- stateless API, and turns owned by the agent service with durable events
  (§5.5);
- a Postgres streaming standby, and a promotion runbook that has actually been
  run;
- backups independent of both application hosts;
- written and drilled RPO and RTO targets (§6).

A standby that has never been promoted, and a backup that has never been
restored, provide no availability.

## 5. Decisions

### 5.1 One API process until it is stateless

**Decision.** Profile A runs exactly one `api`.

**Why.** The API isn't the bottleneck. `load/browse.js` budgets p95 at or below
400 ms at 20 rps, and the measured baseline is `knowledge_search` p95 ≈ 260 ms
at 10 rps (`load/README.md`, on a workstation). The real limits are embedding
CPU, turn RAM and provider rate limits, and adding replicas fixes none of them.
A second replica today breaks the rows marked **breaks** in §2.2.

**Revisit.** In profile B, once uploads are in Postgres and turns live in the
agent service (§5.5). From then on, two replicas rolled with `docker-rollout`
make API deploys invisible to users.

### 5.2 No Redis

**Decision.** Postgres carries every coordination need:

- job queues with `FOR UPDATE SKIP LOCKED`;
- turn events and approvals as tables, woken by `LISTEN/NOTIFY` (payload
  limited to an id);
- throttles.

**Why.** Redis would be a second stateful service to secure, monitor and back
up, and the work history it held would have to be durable anyway. At tens of
events a second, Postgres isn't stretched.

**Revisit when any of these holds:**

- more than about 200 concurrent SSE streams spread over several API
  replicas;
- rate limiting that must be shared between replicas at high request rates;
- `LISTEN` connections or NOTIFY latency showing up as pressure in
  `pg_stat_activity`.

Even then, Redis stays a cache and a bus, never the only copy of a job's
history.

### 5.3 Jobs: kinds in code, definitions in the admin page

**Decision.** A general job layer that later features plug into: syncs,
reindexes, sweeps, detectors, and anything else that runs on a schedule or in
response to something. It has three parts:

| Part           | Lives in                 | Who changes it                    | Example                                                           |
| -------------- | ------------------------ | --------------------------------- | ----------------------------------------------------------------- |
| **Kind**       | code, next to its domain | a developer, by pull request      | `repo.reindex` in `core/src/code`, `source.sync` in `sources`     |
| **Definition** | `job_definitions` table  | a global admin, in the UI         | "reindex repo `billing`, nightly at 02:00, heavy, notify Teams"   |
| **Run**        | `job_runs` table         | the scheduler, an event, a button | run #812: started 02:00, 40% done, lease held by `worker-heavy-1` |

**No scripts from the UI.** The UI never uploads, edits or runs code. A worker
that ran admin-written scripts would turn one compromised admin session into
arbitrary code with the worker's database access, and the code would skip
review, CI and typechecking. New behaviour arrives as a new kind in a pull
request. Admins then enable, schedule and parameterise it without a deploy.

#### 5.3.1 A kind

```ts
defineJob({
  kind: "repo.reindex",
  title: "Reindex a linked repository",
  params: z.object({ repo: repoSlug, full: z.boolean().default(false) }),
  connection: "github", // optional: which source type it runs against
  defaultSchedule: "0 2 * * *",
  resourceClass: "heavy",
  overlap: "skip", // skip | queue: when the previous run is still going
  missed: "run-once", // run-once | skip: when the host was down at fire time
  timeout: "2h",
  maxAttempts: 3,
  run: async (ctx, params) => {
    // ctx.signal (cancel), ctx.progress(0..1, note), ctx.log(), ctx.heartbeat(),
    // ctx.credential(name), ctx.enqueue(kind, params)
  },
});
```

- **Registry.** Kinds register at worker start, the way sources register
  today (`registerSource`). The API reads the same registry to validate
  definitions and describe kinds to the UI.
- **Parameters.** The Zod `params` schema is the only description. The API
  serves it to the SPA as JSON Schema, and the SPA renders the form from that.
  The SPA never imports core (`CLAUDE.md`).
- **Connections.** A kind that works against a source declares its source type.
  Its form then offers a picker of existing `source_connections` of that type
  instead of free text.
- **Secrets.** A parameter that needs a secret takes a vault credential _name_,
  rendered as a credential picker. `ctx.credential(name)` resolves it at run
  time. Secret values never sit in `params`.
- **Shared vocabulary.** Kind ids, trigger types, statuses and resource class
  names go in `@tachy/contract`, since both sides enforce them.

#### 5.3.2 Tables

- **`job_definitions`:**
  - `kind`, `name`, `params` (jsonb, validated against the kind on every save
    and at worker start), `enabled`;
  - `schedule` (cron, nullable), `timezone` (IANA; defaults to an org-wide timezone setting);
  - `resource_class`, `timeout` and `overlap`, each overriding the kind's
    default;
  - `notify` (on failure, on success, never);
  - `created_by`, `updated_by`, and timestamps.
- **`job_runs`**:
  - `definition_id` (null for one-off runs), `kind`, `params` snapshot;
  - `trigger` (`schedule` / `manual` / `event`), `scheduled_for`,
    `requested_by`;
  - `status` (`queued` / `running` / `succeeded` / `failed` / `cancelled` /
    `timed_out`), `attempts`, `run_after` (backoff);
  - `locked_by`, `locked_until` (a lease the worker extends by heartbeat);
  - `progress`, `progress_note`, `output` (small jsonb summary), `error`,
    `log_tail` (the last ~200 lines, passed through redaction);
  - timestamps.
  - Unique `(definition_id, scheduled_for)`, so a double firing inserts one run.
- **`job_definition_changes`:** who changed what, old and new values. A
  schedule edit can silently stop a sync, so every change is recorded.

#### 5.3.3 Triggers

| Trigger      | How a run is created                                                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Schedule** | The scheduler, on the worker holding `pg_try_advisory_lock`, inserts due runs every 30 s. After downtime it applies the definition's `missed` policy once, not once per missed slot.   |
| **Manual**   | "Run now" in the UI inserts a run with `trigger = manual` and the admin as `requested_by`.                                                                                             |
| **Event**    | Code that changes data inserts the run **in the same transaction**, then `NOTIFY job_runs`. A run can't be lost, and nothing polls. Example: a message ingested queues `message.scan`. |

Workers `LISTEN` for new runs and also poll every 10 s, so a missed
notification costs seconds, not a run.

#### 5.3.4 Resource classes

Memory and CPU limits are cgroup settings, fixed when a container starts.
Setting them per run from the UI would need the Docker socket or host systemd,
which hands the web app the host (§7). So:

- **Classes are worker pools declared in Compose.** Each pool claims only runs
  of its own class:

  | Class   | Service        | mem_limit | cpus | Runs at once | Counts against the chat cap as |
  | ------- | -------------- | --------- | ---- | -----------: | -----------------------------: |
  | `light` | `worker-light` | 512m      | 1    |            4 |                        0 slots |
  | `heavy` | `worker-heavy` | 2g        | 4    |            1 |                        3 slots |

- **In the UI,** a definition picks a class. Knobs a process can enforce
  itself are also set there: timeout, overlap, embedding priority and batch
  size, and ONNX thread count.
- **Shared budget.** Heavy runs take chat slots (§3.2) while they run. The UI
  shows the effect before saving: "while this runs, the chat cap is 12". A
  heavy definition can require that fewer than N chats are active before it
  starts.
- Pool sizes and limits stay in Compose, visible in the UI but not editable
  there.

#### 5.3.5 Running a run

- **Claiming:** `update … where id = (select … for update skip locked limit 1)`,
  filtered by class. A reaper requeues runs whose lease expired.
- **Cancelling:** the UI sets `cancel_requested`, the worker aborts
  `ctx.signal`, and the kind stops at its next check. After a grace period the
  worker kills the run.
- **Retries:** exponential backoff up to `maxAttempts`. After that the run
  stays `failed` and appears in the UI's failures list.
- **Deploys:** workers drain like the API does (§9): no new claims, in-flight
  runs get the grace period, and the lease handles the rest.
- **Schema drift:** a stored definition whose params no longer validate
  against the new release is disabled at worker start, with the error shown on
  the definition. The worker doesn't crash.
- **Logs:** `ctx.log` goes to the container log with the run id, and the tail
  goes to `log_tail` after passing through `redactForLlm`. A kind that
  handles customer text must never print raw values.
- **Alerting:** `tachy-watch` checks failed runs and overdue schedules through
  `/api/system` (§8.2). Per-definition `notify` sends to a second Teams
  workflow whose URL is a vault credential. `tachy-watch` keeps its own URL on
  the host, so host alerts still work while the application is down.
- **Retention:** runs keep 90 days; failed ones 180.

#### 5.3.6 What stays out of the job layer

Backups, restore tests, `tachy-watch` and the heartbeat stay host systemd
timers (§6.1). They have to run when the application is broken, so the admin
page shows them (§5.13) and never schedules them.

#### 5.3.7 First kinds

Built to prove the layer, not as a feature list:

- `repo.reindex`, which replaces the fire-and-forget indexer in
  `routes/repos.ts:178` and its in-memory guard;
- `source.sync`, per connection, which replaces the CLI-only `sync`;
- `embeddings.backfill`;
- `retention.sweep`: outputs, uploads, transcripts, usage counters (§7);
- `wiki.gaps`, which replaces the hourly timer in `api/src/index.ts:55`.

**Why.** It extends what is already there: `repos.index_status`
(`db/schema.sql:932`), `sweepInterruptedIndexes` (`core/src/code/repos.ts:218`)
and `source_connections.last_synced_at`. It takes indexing and sweeps out of
the request process. Future integrations then become a kind plus a definition,
with no new infrastructure.

**Alternatives.**

- pg-boss, for the queue alone, if the in-house version grows past a few
  hundred lines. It keeps its own schema outside `schema.sql`, which is the
  cost, and it has no notion of definitions configured in a UI.
- n8n, Windmill or Temporal. Each is a second stateful service with its own
  users, and they run user-written code, which is what this decision rules
  out.

**Later: scheduled agent prompts.** A kind that runs an agent turn on a
schedule, such as "summarise yesterday's escalations". An unattended run can't
answer approvals, so it gets read-only tools only, a service identity, a token
budget per definition, and shows in cost reporting.

### 5.4 One embedding model per host

**Decision.** Exactly one process on the host holds the embedding model, and it
never runs on an event loop that serves requests.

- **Phase 1:** the API starts the model in a `worker_threads` worker at boot.
  The worker keeps two queues: queries, which always go first, and passages,
  taken in batches of 8 between queries. The API exposes
  `POST /internal/embed` on the Compose network only; Caddy doesn't route it.
  `core/src/search/embeddings.ts` gains a `TACHY_EMBED_URL` switch.
  - With it set, embedding calls go over HTTP. Every MCP child the API starts
    gets it, together with a per-boot secret it must send, so no child ever
    loads the model.
  - With it unset, embedding runs in-process, as today. That covers the CLI,
    the tests, `scripts/eval-embeddings.ts`, and developers running the MCP
    server from `.mcp.json` against their own database.
- **Phase 2:** the same worker moves into an `embedder` service and
  `TACHY_EMBED_URL` changes. The worker service sends passages at low priority.
  On 16 GB a second model copy isn't affordable.
- **Independently of both:** the passage batch drops from 32 to 8.

**Impact, measured (§3.1):**

| What                          | Before                                              | After                                            |
| ----------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| Memory per turn               | ~1.38 GB                                            | ~0.39 GB (0.55 GB budgeted)                      |
| Memory, whole host            | one model per searching process                     | one model, ~0.96 GB, loaded at boot              |
| First search in a turn        | ~1.5 s model load, then ~0.8 s                      | ~11 ms embed plus an HTTP hop, then the query    |
| A reference save or reindex   | freezes whichever process runs it for 3.7 s a batch | freezes nothing; queries jump the passage queue  |
| Search results                | —                                                   | unchanged: same model, same vectors, same SQL    |
| Throughput for bulk embedding | 64 passages in 7.4 s                                | 7.3 s, in batches of 8                           |
| API boot                      | model loads on first search                         | model loads at boot; `/readyz` waits for it (§9) |

**What gets worse:**

- **One queue for everyone.** A 500-chunk reference document saved by one turn
  takes about a minute of passage embedding. Queries still go first, but the
  other turns' knowledge saves wait behind it. The passage queue therefore also
  takes turns between callers, one batch each.
- **A new internal endpoint.** It accepts text and returns vectors, and it
  reads and writes nothing. It isn't routed by Caddy and requires the per-boot
  secret. Leaking the secret gives only the ability to use CPU, which the
  request-size limit bounds.
- **The API is a dependency of the MCP child.** It already is, since the API
  spawns the child and owns its turn. If the worker thread dies, the API
  restarts it; searches fail with a retryable error until it's back, and
  `/readyz` goes red.
- **The model is always in memory,** about 1 GB even when nobody searches.
  Today that happens after the first search anyway.

### 5.5 Agent turns: admission control now, an agent service later

**Phase 1, still in the API process:**

- a global cap of 15 slots, where a Claude turn is 1 slot and a Copilot turn 4
  until measured (§3.2), held in a setting;
- **one active turn per user.** The chat UI already sends one message at a time
  (`chat.busy` in `ChatView.svelte`), but the server doesn't enforce it, and a
  second turn happens anyway:
  - `ChatView` aborts its fetch when it unmounts, the server keeps the turn
    running (`routes/agent.ts:44-60`, reaped only after an hour), and the user
    can come back and send again;
  - a second browser tab has its own `busy` flag;
  - the abandoned turn can't be seen or approved, because the chat can't
    reconnect.

  So a new message from a user with a turn still running returns 409 with that
  turn's id, and the UI offers to stop it. A turn whose SSE stream closes
  without an approval pending is aborted after 30 s. Callers using the API
  token share one identity (`env.userEmail`), so they count as one user, which
  is correct for a single integration;

- beyond the cap, a `queued` SSE event with a queue position; past a short
  queue, 429;
- `NODE_OPTIONS=--max-old-space-size=256` for the MCP children;
- the MCP child compiled to JavaScript, since it halves the child and its start
  time (§3.1). This moves forward from §5.11 for the MCP entry point alone;
- a pool of `max: 2` and `idle_timeout: 30` for the MCP child, set by env in
  `db.ts`. 15 turns × 2 is 30 connections;
- an SSE keepalive comment every ~20 s, because approvals can wait 15 minutes
  (`agent/src/turn.ts:10`) and idle connections get cut.

**Profile B, an `agent` service that owns turns:**

- `turns` and `turn_events` tables;
- the client resumes with `GET /api/agent/turns/:id/events?after=N` (the chat
  today is a POST fetch-stream that can't reconnect);
- approvals are written to the database and delivered by NOTIFY;
- API deploys no longer touch turns, and agent deploys drain;
- agent replicas are routed sticky by user, because Claude transcripts are on
  disk;
- `turn_events` holds tool results, which means customer data, so it gets a
  short retention and is excluded from dumps.

### 5.6 No object storage

**Decision.** No MinIO or NAS for application data. Exports already live in
Postgres. Uploads move to a `bytea` table with a TTL, following the
`generated_outputs` pattern. That fixes the cross-replica upload problem, and
the sweep that uploads have never had.

**Revisit.** If uploads regularly approach the 25 MB limit
(`routes/agent.ts:62`), or several hundred MB a day, then the database is the
wrong home for them.

### 5.7 Caddy at the edge

**Decision.** Caddy is the only published service, on 443 with 80 redirecting.
The API stops publishing 8787.

**TLS,** in order of preference:

- the company domain with a DNS-01 challenge: publicly trusted, and nothing to
  distribute to clients;
- a certificate from the company's own CA;
- Caddy's internal CA, with its root pushed to machines by GPO or Intune.

**Why now.** Entra requires it: "Redirect URIs must begin with the scheme
`https`, with exceptions for some localhost redirect URIs"
([docs](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)).
The session cookie's `Secure` flag trusts `X-Forwarded-Proto`
(`api/src/auth.ts:58-62`). That is safe only if the API is reachable nowhere
except through the proxy.

### 5.8 Compose, not Kubernetes

Compose on profiles A and B. Profile C is two Compose hosts behind a VIP.
Kubernetes only if an existing team already runs it, or the deployment grows to
several machines with frequent independent releases.

### 5.9 Postgres configuration and roles

**Config.** A mounted `postgresql.conf`. These are starting points, to tune
from `pg_stat_statements`:

| Setting                               | Value                | Why                                                            |
| ------------------------------------- | -------------------- | -------------------------------------------------------------- |
| `shared_buffers`                      | 1GB                  | the database (148 MB) and its HNSW indexes fit many times over |
| `effective_cache_size`                | 4GB                  | what the page cache realistically holds on 16 GB               |
| `maintenance_work_mem`                | 512MB                | HNSW builds and reindexing                                     |
| `work_mem`                            | 16MB                 | facets and ranking sorts                                       |
| `random_page_cost`                    | 1.1                  | NVMe                                                           |
| `max_connections`                     | 100, explicit        | sized to the pools below                                       |
| `shared_preload_libraries`            | `pg_stat_statements` | slow-query visibility                                          |
| `log_min_duration_statement`          | 500ms                |                                                                |
| `idle_in_transaction_session_timeout` | 60s                  |                                                                |
| `wal_compression`, `max_wal_size`     | on, 2GB              | fewer checkpoints during bulk embedding                        |

`shm_size: 1gb` is already set in `docker-compose.yml`, since Docker's default
`/dev/shm` is 64 MB and parallel HNSW builds failed without it.
Pin the image to a pgvector version as well as a Postgres major: the floating
`pg16` tag can change the extension under a running database.

**Pools,** per process type:

| Process   | Pool `max` |
| --------- | ---------: |
| api       |         15 |
| worker    |          5 |
| MCP child |          2 |
| cli       |          5 |

**Roles,** created in `db/roles.sql`. It is idempotent, and it runs after
`schema.sql` on a fresh volume and again on every deploy, because a new table
needs its grants. Passwords never sit in SQL: `deploy/postgres/role-passwords.sh`
sets them from `.env`.

| Role           | Used by                   | Rights                                                                                                             |
| -------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `tachy_owner`  | schema apply              | owns every object. Not created yet: the bootstrap superuser owns the schema until the diff tool (§5.10) applies it |
| `tachy_app`    | api, worker, MCP children | DML on application tables, `statement_timeout` (the worker raises it for long jobs)                                |
| `tachy_backup` | `pg_dump`                 | `pg_read_all_data` (Postgres 14+)                                                                                  |

**Why the roles.** The MCP child is driven by a model and receives
`DATABASE_URL` (`routes/agent.ts:119`), which today is the image's superuser. A
superuser can run `COPY … TO PROGRAM`. The tools expose no raw SQL, but
least privilege is the second wall. Replace the default password `tachy` with a
generated one.

### 5.10 Schema upgrades: a declarative diff of `schema.sql`

**Decision.** `schema.sql` stays the only source, and no migration files are
ever written. At deploy, a tool diffs the live database against `schema.sql`,
prints the plan, and applies it.

**Candidates,** to evaluate in a spike against the real schema:

- [pg-schema-diff](https://github.com/stripe/pg-schema-diff) (Stripe).
  Postgres 14–17; builds indexes concurrently; checks plans against a
  temporary database; flags hazards. Its README lists "Types (Only enums are
  currently supported)" and renames as unsupported, and says nothing about
  extensions, functions, triggers or generated columns. The spike has to find
  out.
- [pgschema](https://github.com/pgplex/pgschema). A dump, plan and apply
  workflow using an embedded Postgres, with triggers and other objects in
  scope per its docs. **To verify** against this schema.
- [Atlas](https://atlasgo.io/declarative/apply). Out of the box it manages only
  "schemas, tables, and their associated indexes and constraints"; functions,
  triggers and extensions are "available to Atlas Pro users". So it only works
  here as a paid product.

**What the spike must cover:** the 3 extensions, `tachy_join`, the generated
`tsvector` and `search_text` columns, the triggers, HNSW indexes with
`with (m, ef_construction)`, and `gin_trgm_ops`.

**Acceptance:**

1. Load the old `schema.sql` plus `test/fixtures.sql`, diff to the new schema,
   and apply.
2. A second diff must be empty.
3. Destructive statements are flagged.
4. It runs offline in CI and on the host.

**Rules that remain:**

- Renames look like a drop plus an add to every diff tool. A rename ships as
  expand and contract instead: add the new column, backfill, move the code over
  to it, and drop the old one in a later release.
- On Postgres 16, changing a generated column's expression means dropping and
  re-adding the column.
- Changing the embedding model or vector dimension stays a dump/restore plus
  `npm run sync reembed` (CONTRIBUTING.md), or a new column backfilled and then
  swapped in.
- Profile B's two-replica deploys need every schema change to be compatible
  with both the old and the new image. Expand and contract becomes the norm.

If no candidate passes, dump/recreate/restore stays the path, rehearsed in CI
on every schema change (§10).

### 5.11 Build once, deploy by digest

**Image:**

- a multi-stage build: compile TypeScript, then `npm ci --omit=dev` in the
  runtime stage;
- `CMD ["node", …]` with `init: true`. Compose's `init` "runs an init process
  (PID 1) inside the container that forwards signals and reaps processes"
  ([docs](https://docs.docker.com/reference/compose-file/services/)), which
  matters because every turn leaves child processes behind;
- a pinned base image, with Dependabot bumping the digest;
- dropping `tsx` at runtime also shortens every MCP spawn.

**Pipeline:**

- GitHub Actions builds once per commit and pushes `tachy:sha-<commit>`.
  `main` and `dev` are convenience tags only; deploys resolve to a digest.
- Registry: GHCR, or the existing private Docker Hub repository, chosen by
  storage quota, since the image is over 1 GB with the model (§15).
- The laptop never builds. It pulls.

### 5.12 Rejected: one shared MCP server for all turns

**The idea.** One long-lived MCP server that every turn reaches over streamable
HTTP, instead of a child process per turn.

**The gain.** 0.15 GB per turn once the model is out of the child (§3.1), which
is about 6 more turns on 16 GB. A 32 GB module gives 25 more (§3.2).

**Why it's rejected.** The child is per-turn today, and several security
properties depend on that without saying so. A shared server would break each
of them:

1. **Identity is process-global.**
   - `env.userEmail`, `env.actor` and `env.turnId` are parsed once at import
     (`core/src/infra/env.ts`).
   - `resolveCurrentUserId` caches the first answer in a module variable
     (`core/src/access/users.ts:35`).
   - Every permission check in `mcp/src/permissions.ts` (`gateUserId`,
     `requireCanEdit`, `requireGlobalAdmin`), every audit actor, and every tool
     count reads from those.

   In a shared process, every turn would act as whoever called first. Fixing
   it means moving identity into request-scoped context
   (`AsyncLocalStorage`) everywhere. A single path that loses the context,
   such as `inBackground`, which resolves the user after the tool has returned
   (`mcp/src/server.ts:26`), silently attributes or authorises as someone
   else.

2. **Credentials would move from one user to all users.**
   - Today the API resolves the caller's source tokens and passes only those
     into the child's environment (`routes/agent.ts:158-174`). The child has no
     `TACHY_SECRET_KEY`, and `resolveSource` falls through to those variables
     (`core/src/sources/registry.ts`, `config/credentials.ts:66`).
   - A shared server has to decrypt per request, so the vault key would live
     in the one process a model drives with untrusted ticket text.
   - A bug in any tool would then reach every user's Freshdesk, GitHub and
     Azure DevOps tokens. Today it reaches one user's. This is the invariant
     `CLAUDE.md` names: "must never be pooled across users".

3. **Writes in source systems would carry the wrong person.**
   `create_ado_work_item` and `post_private_note` act with the token they're
   given. If a request is scoped to the wrong token, B's note is posted in
   Azure DevOps or Freshdesk as A. That is visible to customers and colleagues,
   and can't be undone by tachy.

4. **Redaction becomes stale.** `TACHY_REDACT` is written into
   `process.env` once at start (`config/settings.ts:145`), behind a settings
   cache. An admin turning redaction on would not reach the shared server until
   it restarts, and in the meantime unredacted customer data goes to the model
   provider. Today each turn reads the setting fresh.

5. **The transport becomes a network service.**
   - stdio is a private pipe to the parent. HTTP is a port that anything on
     the Compose network can reach.
   - It would need a per-turn capability token that is minted by the API,
     bound to user, team and turn, expired when the turn ends, and checked on
     every request.
   - The MCP session id must never stand in for that token.
   - The SDK's DNS-rebinding protection is off by default: "Default is false
     for backwards compatibility"
     (`@modelcontextprotocol/sdk` 1.30.0,
     `server/webStandardStreamableHttp.d.ts`), so it would have to be enabled
     or replaced with middleware.

6. **Failures stop being isolated.**
   - A crash, a leak, or a blocking tool (PDF extraction in `ingest_context`,
     spreadsheet building in `export_table`) hits every turn at once. Today it
     hits one.
   - The event loop becomes shared, which is what §5.4 exists to avoid for
     embeddings.

**What stays true either way.**

- The agent has no shell, file or web tools (`DISALLOWED_BUILTINS` in
  `agent/src/tools.ts`), so it can't read `/proc/<pid>/environ` of another
  turn's child, although every child runs as the same `node` user. Keep that
  list in place: it is what makes same-uid children acceptable today.
- Uploads for all users share one directory, and the MCP child may read any
  file in it (`mcp/src/extract.ts:32`). Names start with a random UUID
  (`routes/agent.ts:383`), so reaching another user's upload needs its path.
  Scoping uploads per user is a small improvement, independent of this
  decision.

**Revisit** only if RAM can't grow and turns queue in normal use. Even then, do
it as its own project with the six points above as acceptance criteria, and a
security review of the result.

### 5.13 What admins see and configure

Global admins only. Everything configurable is a database setting or a job
definition. Nothing in the UI reaches the host.

| Area        | Shown                                                                        | Configurable                                                                                    | Host or `.env` only (shown at most)                   |
| ----------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Chats       | active and queued against the cap, api memory, abandoned turns               | slot cap, Copilot weight, approval timeout                                                      | api `mem_limit`                                       |
| Embeddings  | query and passage queue depth, worker thread health                          | passage batch size, ONNX threads                                                                | —                                                     |
| Jobs        | runs, progress, log tail, failures, next fire times                          | definitions: kind, params, schedule, timezone, class, timeout, overlap, notify; run now; cancel | worker pool sizes and limits                          |
| Sources     | traffic, rate limits, auth failures (exists today)                           | sync cadence, as a `source.sync` definition                                                     | —                                                     |
| Backups     | last backup, last restore test, downloads per person                         | —                                                                                               | schedule, recipients, downloaders                     |
| Monitoring  | `tachy-watch` check states, last Teams delivery                              | —                                                                                               | webhook URL, since alerts must work with the app down |
| Host        | disk per mount, temperature, throttling, AC, battery, SMART                  | —                                                                                               | everything                                            |
| Release     | commit, image digest, environment badge, deploy log, CI run                  | —                                                                                               | deploying and rolling back                            |
| Schema      | drift between the live database and the image                                | —                                                                                               | applying changes                                      |
| Retention   | table and volume sizes                                                       | usage counter months, transcript days, upload and output TTL                                    | —                                                     |
| Security    | password login state, users with passwords, certificate expiry, vault key id | password login policy under SSO                                                                 | vault key, session secret, TLS, firewall              |
| Load tests  | runs and results (§11.3)                                                     | start and cancel runs, the load-test window                                                     | targets                                               |
| Maintenance | draining                                                                     | **drain**: refuse new chats before a deploy                                                     | —                                                     |

Host state reaches the page through read-only status files in
`/srv/tachy/status/` (§8.1). A deploy or rollback button is deliberately absent:
it needs host privileges from the web app.

## 6. Durability, backup, restore

| Profile | RPO                                                                                                                      | RTO      | Mechanism                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------- |
| A       | bad write or corruption: ≤ 6 h. Host lost: the age of the newest laptop copy, at most 7 days if the reminder is acted on | ≤ 4 h    | encrypted `pg_dump` every 6 h; people download it over SFTP now and then; host rebuilt from `deploy/host/` |
| B       | ≤ 5 min                                                                                                                  | ≤ 1 h    | pgBackRest WAL archiving to separate storage; laptop downloads continue                                    |
| C       | ≈ 0 for host loss, ≤ 5 min for bad writes (PITR)                                                                         | ≤ 15 min | streaming standby and a promotion runbook                                                                  |

**What gets backed up**

| Item                                    | Backed up? | Notes                                                                                                                                              |
| --------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres                                | yes        | exclude table data for `generated_outputs` (24 h downloads) and, later, `turn_events`. `library_assets` stays in: the dump is its only copy        |
| `tachy-agent-home` (Claude transcripts) | yes, daily | small, and lets chats resume; holds customer data, so it leaves the host only encrypted                                                            |
| Secrets                                 | no         | kept in the password manager: `TACHY_SECRET_KEY`, `TACHY_SESSION_SECRET`, database passwords, the OIDC secret, the backup and break-glass age keys |
| Deploy log (commit → digest → time)     | yes        | the record of what can be rolled back to                                                                                                           |
| Repo clones, model cache, images, logs  | no         | rebuildable, or retained elsewhere                                                                                                                 |

Losing `TACHY_SECRET_KEY` makes every stored credential unrecoverable (AES-256-GCM,
`core/src/infra/secrets.ts`). Its ciphertext carries no key version, so rotating
the key means an offline decrypt-and-re-encrypt. Adding a key id is on the
backlog.

### 6.1 Producing backups on the host

Backups are host systemd timers, not application jobs, so they still run when
the application is broken.

1. Every 6 h, `docker compose exec -T postgres pg_dump -Fc`, as `tachy_backup`,
   writes into a root-only staging directory, `/srv/tachy/backups/staging`.
   Never under `/var`, and never inside the checkout.
2. On the weekly run, the plaintext dump is restore-tested before anything else
   (§6.4).
3. `age -R /etc/tachy/backup-recipients.txt` encrypts it to
   `tachy-db-<UTC timestamp>.dump.age`. Once a day the agent-home volume goes
   the same way, as `tachy-agent-home-<timestamp>.tar.zst.age`.
4. A `.sha256` of each ciphertext is written beside it.
5. Each file is written as `.partial`, then renamed into
   `/srv/tachy/backup-export/`, so a pull never picks up a half-written file.
   The plaintext is deleted.
6. The export directory keeps every dump for 2 days, one a day for 14 days, and
   one a week for 8 weeks. Downloads are occasional, so the history lives on
   the host, and a laptop only needs the latest.
7. The run writes its result to `/srv/tachy/status/backup.json` and pings its
   external heartbeat.

**The recipients** are two age keys: the team backup key, and a break-glass key.
Both private halves live only in the password manager, never on the server and
never on a laptop. Laptops therefore hold ciphertext only, and a stolen laptop
leaks nothing without the password manager.

age can also encrypt to people's SSH keys, but that isn't used here. It can't
use ssh-agent, hardware-backed SSH keys can't decrypt
([age README](https://github.com/FiloSottile/age)), and a person's key leaving
with them would strand old backups.

When someone with access to the team key leaves, generate a new one for future
backups. Keep the old key in the password manager until the last backup
encrypted to it has aged out.

### 6.2 Downloading backups: configurable SFTP connections

People download backups to their Windows laptops by hand, now and then. The
host never pushes anything. It therefore holds no credentials to anyone's
machine, and a compromised host can't delete copies that are already on a
laptop.

**Downloaders.** A downloader is a person allowed to fetch backups. Each one
gets their own SFTP login on the host, tied to an SSH key on their laptop, and
that login can do nothing else. Have at least two, so the backups never live on
a single laptop.

The list of downloaders is configuration in the host playbook
(`deploy/host/`):

```yaml
backup_downloaders:
  - name: alice
    ssh_pubkey: "ssh-ed25519 AAAA… alice-tachy-backup"
  - name: bob
    ssh_pubkey: "ssh-ed25519 AAAA… bob-tachy-backup"
    from: "10.20.0.0/16" # optional; defaults to the office LAN
```

For each entry the playbook:

- creates a user `tachy-backup-<name>` with no password and no shell, in group
  `tachy-backup`;
- writes its `authorized_keys` line with `restrict,from="…"`.

One `sshd_config` block covers the whole group:

```text
Match Group tachy-backup
    ChrootDirectory /srv/tachy/backup-export
    ForceCommand internal-sftp -R -l INFO
    AuthenticationMethods publickey
    DisableForwarding yes
    PermitTTY no
```

- `-R` makes the SFTP server read-only: "Attempts to open files for writing, as
  well as other operations that change the state of the filesystem, will be
  denied" (`sftp-server(8)`).
- `-l INFO` logs every transaction.
- sshd requires every component of the chroot path to be root-owned and not
  writable by group or others (`sshd_config(5)`). The export directory is
  therefore `root:root 0755`, and its files are `root:tachy-backup 0640`.

A login per person, rather than one shared account, means the log shows who
downloaded what, one laptop can be revoked alone, and each person can get their
own `from=`.

- **To add a downloader:** on their laptop, in PowerShell, they run
  `ssh-keygen -t ed25519 -f $HOME\.ssh\tachy_backup` and give the key a
  passphrase. Downloads are manual, so typing it costs nothing. They send the
  `.pub` file; the operator adds it to `backup_downloaders` and runs the
  playbook.
- **To remove one:** delete the entry and run the playbook.

**Laptop side: `Get-TachyBackup.ps1`.** A PowerShell script in `deploy/backup/`
that uses only what Windows ships with:

- `sftp.exe`, from Windows' in-box OpenSSH client (Windows 10 1809 and later).
  If it's missing, an admin adds it with
  `Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0`
  ([docs](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse)).
- `Get-FileHash`, whose default algorithm is SHA-256
  ([docs](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/get-filehash)).

Connections live in one JSON file, `%APPDATA%\tachy\backup-connections.json`.
A laptop can hold several: this laptop server now, a department server later.

```json
{
  "connections": [
    {
      "name": "office",
      "host": "tachy.office.lan",
      "port": 22,
      "user": "tachy-backup-alice",
      "identityFile": "~/.ssh/tachy_backup",
      "knownHostsFile": "~/.ssh/tachy_known_hosts",
      "destination": "D:/tachy-backups/office",
      "keepSets": 10,
      "minFreeGB": 50
    }
  ]
}
```

| Command                              | Does                                                    |
| ------------------------------------ | ------------------------------------------------------- |
| `Get-TachyBackup`                    | downloads the newest set from every connection          |
| `Get-TachyBackup -Connection office` | the same, for one connection                            |
| `Get-TachyBackup -List`              | shows what the host holds, and what's already local     |
| `Get-TachyBackup -All`               | downloads every file the host has that the laptop lacks |

A _set_ is the newest database dump plus the newest agent-home archive. For
each file, the script:

1. stops if the download would leave less than `minFreeGB` free;
2. downloads to a `.partial` file;
3. keeps the file only if `Get-FileHash` matches the `.sha256` beside it;
4. deletes sets older than the newest `keepSets`;
5. appends a line to `pulled.log` in the destination.

**Host key pinning.** `knownHostsFile` holds the host's key, which ships with
the runbook, and the script runs sftp with `StrictHostKeyChecking=yes`. The
first connection is never a "trust this host?" prompt.

**Disk.** A laptop holds `keepSets` × the dump size, plus small agent-home
archives. The dump measured 52 MB (§15.1), so ten sets are about 0.5 GB.
`code_chunks` is 135 MB of the 148 MB database. If linked repositories make the
dump grow large, leave its data, and `repo_files`, out of the export. Reindexing
rebuilds both, at the cost of a longer RTO.

**Without the script.** For a one-off, WinSCP with a saved site using the same
settings works; check the file afterwards with `Get-FileHash` against its
`.sha256`. Linux machines can use `sftp` directly.

**Rule.** Laptops that hold backups are company-managed and encrypted with
BitLocker, even though the files themselves are encrypted.

**What "now and then" costs.** If the host itself is lost (stolen, burnt, or its
disk dies), everything written since the newest laptop copy is gone. The host
therefore reminds people: an alert fires when nobody has downloaded for 7 days
(§6.3). Downloading weekly keeps that loss under a week. Downloading more often
shrinks it.

### 6.3 Knowing the copies exist

- **Host:** the backup run writes its result and timestamp to
  `/srv/tachy/status/backup.json`. The watch script alerts when it's older than
  7 h, and the admin checks panel shows it (§11.3).
- **Downloads:** each downloader's transfers show up in the sftp-server INFO
  log, under their own login. The watch script reads it from the journal with
  `journalctl -u ssh`, which gives the last download for each person, and writes
  that to `/srv/tachy/status/downloads.json`. The exact log line format is **to verify** on
  Debian 13's OpenSSH.
- **Alerts:**
  - nobody has downloaded a set in 7 days. This is the reminder to run
    `Get-TachyBackup`;
  - fewer than 2 people have downloaded in 30 days, so the backups may be on
    only one laptop.
- **Heartbeat:** the backup timer pings an external check after publishing. If
  the host dies, the pings stop.

### 6.4 Restore tests

- **Weekly, automated, on the host.** Restore the plaintext dump into a scratch
  Postgres container, using the same pinned image, before the dump is
  encrypted. Check row counts against production within a tolerance, check
  `embedding is null` counts, and check that a schema diff against `schema.sql`
  is empty. Ping a separate check, then tear the container down.
- **Quarterly, manual, from a laptop.** An operator:
  1. installs age with `winget install --id FiloSottile.age`;
  2. takes the team key from the password manager;
  3. decrypts a laptop copy;
  4. restores it into a scratch Postgres on the pinned image, in Docker Desktop
     or on any Linux machine;
  5. runs the same checks, and records how long it took.

  This is the only test of the whole chain (encryption, transfer, key custody),
  and the RTO is based on it.

- **In a real disaster** the laptop is only the courier. Copy the `.age` file to
  the replacement host and decrypt it there.

**Later.** In profile B, pgBackRest adds point-in-time recovery to separate
storage. A cloud bucket or NAS can become another target whenever one exists,
and the SFTP pull keeps working as it is.

## 7. Security

**Network and edge**

- LAN or VPN only. Caddy is the sole published service (§5.7). Postgres stays
  on `127.0.0.1`.
- The host firewall (nftables) allows 443 from the LAN, and 22 from admin
  machines and the backup downloaders' network (§6.2).
- SSH is key-only, with no root login. `AllowGroups` limits it to the admins
  and `tachy-backup`, and the backup group gets read-only SFTP in a chroot and
  nothing else.
- Caddy adds HSTS and security headers, and enforces request-size limits in
  line with the 25 MB upload cap and the 5 MB library image cap.
- Password login is always installed (`api/src/index.ts:22`), including under
  `TACHY_AUTH_MODE=sso`, and is offered once the instance is bootstrapped. So
  SSO does not close the password path. Decide whether it stays for break-glass
  and service accounts, such as the load-test user (§11.3), or is turned off
  under SSO. Its throttle is an in-process `Map` either way.

**Containers**

- `init: true`, and `USER node` (already in place).
- `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`, and
  `read_only: true` with a tmpfs for `/tmp`.
- `pids_limit` on every service. It is the backstop for runaway turn trees.
- No container mounts the Docker socket. The watch script runs on the host,
  outside every container.
- `/srv/tachy/status` is mounted read-only into `api`, so the admin page can
  show backup and host state without any access to the host.
- Operators aren't in the `docker` group, which is root-equivalent. Deploys run
  as `tachy` through the deploy script.

**Database and secrets**

- Least-privilege roles (§5.9), and generated passwords.
- `.env` is mode 0600 and owned by `tachy`, with every secret also in the
  password manager. `.dockerignore` already keeps `.env` out of the image.
- The per-turn MCP env isolation invariant stays as it is: caller-scoped
  tokens, built fresh for each turn (`routes/agent.ts:158-174`).
- Rotation runbooks for the session secret (it logs everyone out), the API
  token, source tokens, provider keys, and the vault key once it has versions.

**Host**

- LUKS full-disk encryption, unlocked by TPM2 (`systemd-cryptenroll`) so the
  laptop comes back unattended after a power cut. It is a laptop, and laptops
  get stolen.
- unattended-upgrades for Debian security updates. Docker comes from Docker's
  apt repository with the major version pinned.

**Data handling**

- Retention: agent-home transcripts grow forever today, so set a policy and
  sweep. Uploads are never swept today, so give them a TTL. `turn_events`
  (profile B) keeps 24–72 h, logs keep 14 days, and `analysis_runs` is kept
  because it holds counts, not content. `library_views` and `mcp_tool_calls`
  are one row per item or tool, per person, per day, so they grow for as long
  as people use the product. Roll them up to monthly after a year, or drop the
  `user_id` from them. `library_assets` needs an orphan sweep for images no
  body references any more.
- Backups leave the host only as age ciphertext, and the key that opens them
  lives only in the password manager (§6.1).
- Every HTTP log line carries the user's email (`api/src/logging.ts:50`). That's
  fine operationally, so reading container logs stays limited to the operators
  who can run `docker compose logs`. Bodies and tokens
  are never logged, and that must stay true.
- Egress the host needs:
  - the model providers (Anthropic, GitHub Copilot);
  - the sources (Freshdesk, GitHub, Azure DevOps) and the linked git remotes;
  - Hugging Face only at build time, because the model is baked into the image.

  Once that list is stable, an allow-list at the office firewall is an option.

## 8. Observability

No metrics stack. On 16 GB, Prometheus, Grafana, Loki and their exporters would
cost 2–3 GB, which is four or five chat turns, to draw graphs of a
single-host service with 30 users. Instead there are three layers, and each
one has a single job:

| Layer              | Answers                                              | Where                                      |
| ------------------ | ---------------------------------------------------- | ------------------------------------------ |
| Admin page         | what the application is doing now, and who uses what | Admin › overview, system, tests (§11.3)    |
| Host watch script  | is something broken, and tell someone                | systemd timer on the host → Teams          |
| External heartbeat | has the whole host gone quiet                        | an external check service, pinged by timer |

The cost is that there's no history of infrastructure numbers: no graph of
memory last Tuesday. When an incident needs history, the logs have it for 14
days, and k6 runs (§11.3) keep latency history per release.

### 8.1 Signals

**Runtime state in the admin page.** `/api/system` gains a `runtime`
block, current values only, with no time series. It feeds the checks panel:

- turns active, queued and rejected since boot, per provider, against the slot
  cap;
- the api container's memory from its own cgroup (`memory.current` against
  `memory.max`), which is the capacity signal, since turn trees live there;
- event-loop delay p99 over the last minute (`perf_hooks.monitorEventLoopDelay`);
- embed queue depth and in-flight count;
- Postgres connections by `application_name` from `pg_stat_activity`. Each
  process sets its own `application_name`, since postgres.js exposes no pool
  statistics;
- pending approvals and the oldest one's age;
- the host state files from `/srv/tachy/status/` (backup, restore test,
  downloads, disk, temperature), mounted read-only.

This is a narrow exception to keeping infrastructure figures out of the
product: with no metrics stack, the admin page is the only place an operator
can see load. It shows the present moment and stores nothing.

**Business metrics.** The admin overview already answers who, which and how
much: library reads, tool calls per person, source traffic by origin,
rate-limit and auth refusals, and wiki gaps (`routes/admin.ts`, `/overview` and
`/overview/activity`). Turns and cost per user and team come from
`analysis_runs`, which needs an index on `created_at`.

**Logs.** The Docker `local` log driver, compressed and rotated, with a 14-day
budget per container, starting now. Every line is one JSON object with an
`event` field (`http`, `mcp_tool`, `repo_index_failed` and so on) and a request
id, so `docker compose logs api | grep <request-id>` follows a request. The MCP
children log an `mcp_tool` line per call (`mcp/src/server.ts:46`), but tachy sets
no `stderr` callback on the agent SDK. Verified on 2026-09-17: those lines never
reach the container log, because Claude Code does not pass an MCP server's
stderr on. A child spawned for a turn therefore also posts each line to the
api's `POST /internal/log` (the same per-boot secret as `/internal/embed`), and
the api writes it with `source: "mcp"`, the turn id and the request id.

**Tracing.** Deferred. Revisit only when turn latency can't be explained from
logs.

### 8.2 The host watch script

`tachy-watch`: a shell script (bash, curl, jq) under `deploy/host/`, run every
minute by a systemd timer as `tachy`.

- Every check reports ok, warn or fail. The script keeps the last state per
  check in `/var/lib/tachy-watch/state.json`, and posts to the Teams workflow
  webhook (§15.1) only when a state changes. A check still failing is reposted
  every 4 hours.
- Each post carries the check, the value, the threshold, and a link to the
  admin page.
- When everything passes, the script pings the external heartbeat. If the host,
  Docker or the script dies, the pings stop and the external service alerts,
  through email or its own Teams integration.

| Check                | Source                                                                 | Warn                             | Fail                           |
| -------------------- | ---------------------------------------------------------------------- | -------------------------------- | ------------------------------ |
| readyz through Caddy | `curl https://<name>/readyz`                                           | —                                | 2 consecutive failures         |
| 5xx rate             | `docker compose logs --since 10m api`, `status >= 500`                 | > 1%                             | > 5%                           |
| api memory           | the container's cgroup `memory.current` / `memory.max`                 | > 85%                            | an OOM kill in `docker events` |
| turns queued         | `/api/system` with the API token                                       | queued > 2 min                   | queued > 5 min                 |
| Postgres connections | `psql` as `tachy_backup`: `pg_stat_activity` count / `max_connections` | > 80%                            | > 95%                          |
| long transaction     | `pg_stat_activity`                                                     | > 5 min                          | > 10 min                       |
| disk, per mount      | `df /var /srv /`                                                       | > 80%                            | > 90%                          |
| backup age           | `/srv/tachy/status/backup.json`                                        | > 7 h                            | > 13 h, or a failed run        |
| restore test         | `/srv/tachy/status/restore.json`                                       | > 8 days                         | a failed run                   |
| laptop downloads     | `/srv/tachy/status/downloads.json`                                     | none in 7 days                   | fewer than 2 people in 30 days |
| certificate          | `openssl s_client` against 443                                         | < 14 days                        | < 3 days                       |
| thermal throttling   | `package_throttle_count` delta                                         | throttling 10 of the last 15 min | 30 of the last 30 min          |
| AC power             | `/sys/class/power_supply/A*/online`                                    | on battery                       | battery < 30%                  |
| NVMe health          | `smartctl -H`, `nvme smart-log` media errors                           | spare < 20%                      | SMART failed, media errors     |

The script is the only alerting there is, so the Phase 1 exit criteria include
making each of these checks fire once.

### 8.3 Service levels

| SLO                               | Target                | Measured by                               |
| --------------------------------- | --------------------- | ----------------------------------------- |
| Availability, 08–19 weekdays      | 99.5% a month         | the watch script's readyz results, summed |
| Non-search API latency            | p95 < 300 ms          | k6 runs per release (§11)                 |
| Knowledge and reference search    | p95 < 1.5 s           | k6 runs per release (§11)                 |
| Source sync freshness             | lag < 2× the schedule | the admin sources panel                   |
| Newest set downloaded to a laptop | < 7 days              | watch script                              |
| Last good restore test            | < 8 days              | watch script                              |

Latency isn't watched continuously. It's checked when something changes: each
release, and any time someone reports slowness. The k6 thresholds use the same
numbers.

## 9. Health, readiness and shutdown

**Probes**

- `/livez`: the process is up, nothing else. Docker's HEALTHCHECK uses it.
- `/readyz`: the database answers, the schema matches what the image expects
  (a one-row `schema_meta` table holds the sha256 of the `schema.sql` that
  built the database, and the image carries its own copy; a database from
  before the stamp reports `unstamped` and stays ready),
  the embedding model is warm (load it at boot, not on the first search), and
  the process isn't draining. Caddy's upstream check and the watch script
  use it.
- Keep `/health` as an alias of `/livez` for existing probes. Detailed
  diagnostics extend `/api/system`, which already exists and already
  shows its `env` block only to admins.

**Shutdown on SIGTERM**

1. readyz returns 503.
2. New turns are refused with a retryable error.
3. In-flight turns get up to the drain period to finish. Make it a few minutes,
   and accept that a turn waiting on approval gets cut.
4. Timers are flushed, the pool is closed, and the process exits.

`stop_grace_period` is set above the drain period. The Compose default is 10 s.

**Crash-only for everything else.** Docker restarts containers on exit, not on
health. So an unrecoverable state (the pool exhausted for minutes, the model
failing to load) should exit the process rather than sit there unhealthy.

## 10. CI/CD

**Pull requests (GitHub Actions)**

1. The existing gates: typecheck, `web:check`, the model cache and `coverage`,
   with its ratchet at 76/74/74/63.
2. The existing k6 bundle check, on a pinned k6 image instead of `latest`.
3. **image:** a Buildx build with cache, and a Trivy scan that fails on
   critical findings with a fix available.
4. **container-smoke:** start the built image with Compose and a CI `.env`
   (token auth), wait for readyz, `sync seed --scale=small`, then run
   `load/smoke.js`. This catches what vitest can't: file permissions as
   `node`, missing env, the SPA build, the image layout.
5. **schema-plan,** when `db/schema.sql` changes: load the merge-base schema and
   fixtures, diff to the PR's schema, apply, and require the re-diff to be
   empty. Upload the plan as an artifact. Hazards fail the job unless the PR is
   labelled `schema-destructive`.
6. **gitleaks.**

Mark these as required checks on `dev` and `main`.

**Pushes to `dev` and `main`:** build once, push `sha-<commit>`, move the
convenience tag, and record the digest. SBOM and provenance attestations are
optional. Today `ci.yml` triggers on pushes to `main` only, so a direct push to
`dev` reaches the dev stack untested. The trigger becomes `[main, dev]`.

**The environment badge is runtime, not build-time.** `VITE_DEV_BADGE` is baked
into the SPA bundle at build time (`Dockerfile:50`, `App.svelte:259`). An image
built for dev therefore always carries the badge, and one image can't serve
both stacks. That contradicts building once and promoting a digest.

- The API reads `TACHY_ENV_BADGE` from the stack's `.env`: `dev` on the dev
  stack, unset on production.
- It sends the badge to the SPA in the config the SPA already fetches at boot,
  next to `passwordLogin` (`api/src/app.ts:86`), and the SPA renders it from
  there.
- `VITE_DEV_BADGE` is removed from the `Dockerfile`, the Compose build args and
  the `Jenkinsfile`.
- `/api/system` reports the badge beside the image SHA, so it's visible
  which environment answered.

The rule: the image never knows which environment it's in. A `main` deploy
shows no badge because production's `.env` sets none, and the dev deploy shows
`dev` because its `.env` does. Promoting a digest from dev to main needs no
rebuild.

**Deploy (pull).** `tachy-deploy <sha|main>` runs on the host:

1. resolve the argument to a digest, and check out the same commit, since
   `docker-compose.yml`, `schema.sql` and `deploy/` travel with it;
2. take a pre-deploy backup (a local dump);
3. plan the schema diff. Stop if it is destructive and `--allow-destructive`
   wasn't given;
4. apply the schema;
5. drain and replace `api`;
6. run k6 `smoke.js`;
7. on failure, redeploy the previous digest automatically;
8. append commit, digest, schema plan and result to the deploy log.

Rollback is `tachy-deploy <previous-sha>`. It is safe only when the previous
image accepts the current schema, which is what expand and contract is for.

It starts out manual. A systemd timer can follow `main` once automatic rollback
has proved itself.

**Retire.** The `Jenkinsfile`, and the README's "both driven by `Jenkinsfile`".

**Dependabot.** `.github/dependabot.yml` has `package-ecosystem: ""`, so it does
nothing. Configure `npm`, `docker` and `github-actions`.

**Dev stack.** The same flow, from `dev`, on its own machine (§15.2), with
`TACHY_ENV_BADGE=dev` in its `.env`. It no longer runs on the office laptop.

## 11. Testing strategy

| Layer                | Tool                                                           | Status                                |
| -------------------- | -------------------------------------------------------------- | ------------------------------------- |
| Unit and integration | vitest, testcontainers Postgres, coverage ratchet              | exists                                |
| Search quality       | `test/search-quality.test.ts`, `scripts/eval-embeddings.ts`    | exists                                |
| Schema drift         | `test/schema-drift.test.ts`, plus schema-plan convergence      | drift test exists; convergence is new |
| Container smoke      | CI job (§10)                                                   | new                                   |
| Load and capacity    | k6                                                             | partly exists                         |
| Backup restore       | weekly host timer; quarterly drill from a laptop copy (§6.4)   | new                                   |
| Browser end-to-end   | Playwright: login, search, open entry, chat against a mock LLM | optional, Phase 2+                    |
| Chaos drills         | manual, every quarter                                          | new                                   |

### 11.1 k6

**Existing, kept** (pin the image):

| Script      | Role                                            |
| ----------- | ----------------------------------------------- |
| `smoke.js`  | the post-deploy gate                            |
| `browse.js` | 20 rps budget                                   |
| `search.js` | 1 → 10 rps, or 5 → 50 with `PROFILE=stress`     |
| `soak.js`   | 2 rps for 30 minutes; memory and pool behaviour |

The only measured baseline so far comes from a workstation. The laptop's
numbers are still needed.

**Out of date in `load/`:**

- `load/README.md` says the scenarios are read-only. They aren't any more:
  opening a knowledge entry or reference doc upserts a `library_views` row
  (`routes/knowledge.ts:239`). The rows are bucketed, so a rerun doesn't make
  the table grow, but the load user shows up in "most read". Either exclude the
  load-test user from engagement queries, or correct the README.
- `smoke.js` doesn't touch the wiki, library images, the admin overview or
  `/api/system`. As the post-deploy gate, it should reach every route
  family at least once.
- It logs in with a password (`load/lib/session.js`), so production needs a
  dedicated load-test user (§11.3).

**New**

- **`turns.js`**: 1 → 10 concurrent chat turns against a mock server that
  speaks the Anthropic Messages API and returns scripted tool calls
  (`search_knowledge`, `get_knowledge_entry`).
  - Claude Code is pointed at it with `ANTHROPIC_BASE_URL`, the documented
    gateway variable
    ([docs](https://code.claude.com/docs/en/llm-gateway)), so it costs nothing.
  - It measures turn latency, MCP spawn time, api container memory against the
    number of turns, and Postgres connections. That produces the per-turn
    figure for §3 and the admission cap.
  - The Copilot backend needs its own measurement: whether its runtime can be
    pointed at a mock is **to verify**.
  - k6 reads the whole SSE body, which measures total turn time. For
    time-to-first-event, use a small Node driver instead.
- **`contention.js`**: `search.js` at 5 rps while a reindex or
  `embed-backfill` runs. Search p95 must stay within 1.5× the idle baseline.
  Run it before and after Phase 2; it is the test that proves the
  worker/embedder separation.
- **`mixed.js`**: weights taken from a week of real traffic.
- **`spike.js`**: 0 → 30 rps in 10 s, the morning login burst. No 5xx, and it
  recovers.
- **`breakpoint.js`**: ramps until a threshold aborts the run. It records the
  knee per release.

**Where load runs.** Never against production while people are using it.

- **Functional checks and heavy scripts** (`soak`, `spike`, `breakpoint`,
  `PROFILE=stress`) run against the dev stack, wherever it lives (§15.2). Seed
  it with `--embed=search`: synthetic vectors make the vector leg contribute
  nothing (`load/README.md`).
- **Laptop numbers** (the per-turn memory in §3, the admission cap and search
  latency) can only come from the laptop itself. They're measured in a **load
  window**, outside working hours:
  1. restore the latest dump into the scratch Postgres the weekly restore test
     already uses;
  2. start a second api container, `api-load`, from the production image
     against that scratch database, with `ANTHROPIC_BASE_URL` pointing at the
     mock LLM and no published port;
  3. run `smoke`, `search`, `contention` and `turns` against `api-load`;
  4. tear both containers down.

  Production keeps serving throughout, but nobody is using it, and no load test
  touches production data or a real provider key.

**Results.** Each run's k6 summary is stored in `test_runs` (§11.3), tagged
with the image SHA, and compared release to release on the admin page.

**Gates.** `smoke.js` after every deploy. `turns`, `search` and `contention`
before any release that touches search, embeddings, the agent or the schema.

### 11.2 Chaos drills

Run each on staging first, then on production in a maintenance window.

| Drill                  | Expected result                                                              |
| ---------------------- | ---------------------------------------------------------------------------- |
| Kill `api` mid-turn    | the turn is marked interrupted, the user sees it, no orphan processes remain |
| Restart Postgres       | readyz flips and recovers; the API reconnects without a restart              |
| Fill `/srv` to 90%     | alerts fire; Postgres survives                                               |
| Pull the network cable | source syncs retry; the external heartbeat alerts                            |
| Pull AC power          | the battery alert fires; the host shuts down cleanly at its threshold        |

### 11.3 Test runs from the admin page

**Where.** A `tests` section on the admin page that also holds backups,
monitoring and release (§5.13, and its name in §15.2), visible only to global
admins.

**What it shows:**

1. **Checks.** Fast, and safe to click at any hour. Each one is a pass, warn or
   fail row with the detail behind it:
   - the database answers, and the live schema matches what the image expects
     (the same check as `/readyz`);
   - the embedding model is loaded, and one query embeds within budget;
   - the vault key decrypts a canary row;
   - every source connection answers (`POST /source-connections/:slug/test`
     already exists; this runs it for all of them);
   - each configured agent backend has a credential;
   - the upload directory is writable (until uploads move into Postgres), with
     free disk on each mount;
   - the newest backup's age, and the last restore test (§6.3);
   - CI status for the running commit, linked to its GitHub Actions run.
2. **Load runs.** An admin picks a script and a profile, then presses start.
   The panel shows live progress, and when the run ends, pass or fail per
   threshold with p95 for each `endpoint` tag. Each result sits beside the
   previous run of the same script, with both image SHAs.

**How a load run executes.** The API never spawns k6 itself. k6 in the api
container would compete for the same CPU it's measuring, and the only
alternative, driving Docker from the API, needs the Docker socket, which §7
rules out.

- A `test_runs` table: `script`, `profile`, `target`, `status`
  (`queued`/`running`/`passed`/`failed`/`cancelled`/`error`), `requested_by`,
  `image_sha`, `summary` (jsonb, from k6's `handleSummary`), `output_tail`, and
  timestamps. A unique partial index on active rows allows one run at a time.
- A `tester` service: the tachy image with a pinned k6 binary copied in from
  `grafana/k6:<version>`, running a small loop that claims queued rows with
  `FOR UPDATE SKIP LOCKED` (§5.2). It has a low CPU weight, a `cpus` cap and a
  `mem_limit`, so its cost is visible and bounded. In Phase 2 this becomes a
  `load_test` job kind in the worker (§5.3).
- The runner spawns `k6 run` with the script from `load/` in the image, streams
  the tail of its output into `output_tail`, and writes the summary when k6
  exits. Cancel sets a flag that the runner turns into SIGINT, and k6 still
  writes its summary.
- A hard wall-clock limit per script. `soak.js` is the longest at 30 minutes.

**Guardrails.** These carry the rule from §11.1: never load production while
people are using it.

- Targets come from config (`TACHY_LOAD_TARGETS`), not from free text, so the
  page can't be turned into a load generator aimed at anything else.
- Against the production target, only `smoke.js` is allowed at any time.
  `browse`, `search` and `contention` need a confirmation naming the target, and
  are allowed only inside a configured off-hours window. `soak`, `spike`,
  `breakpoint` and `PROFILE=stress` run only against the dev stack. `turns`
  and `contention` against the laptop run only in a load window (§11.1).
- A dedicated `load-test` user with a password that only the runner holds
  (in the vault), member role, and no team write rights. It's excluded from
  engagement analytics, and its login doesn't count against people.
- `turns.js` runs only against a target whose agent backend points at the mock
  LLM (§11.1). It never runs against a real provider key.
- Every run is recorded against the admin who started it.

**Results.** `test_runs` is the only store. Its history is the latency record
for §8.3.

**Why not `npm test` from the admin page.** It doesn't fit, for four reasons:

- The suite tests a commit, not an environment. CI has already run it on the
  exact SHA the image was built from, so a rerun on the host can only reproduce
  that result or fail for reasons unrelated to the deployment.
- It needs devDependencies (vitest, testcontainers). The image still ships
  them today (`Dockerfile:36` runs a full `npm ci`), but the multi-stage build
  in §5.11 drops them.
- testcontainers starts Postgres through the Docker socket, which is
  root-equivalent, and §7 keeps it out of every container.
- It truncates and seeds its own schemas. Running it next to production data is
  the kind of mistake the `NODE_ENV=production` refusal on `seed` exists to
  prevent.

Instead, the checks panel links to the CI run for the deployed commit. The
checks, the post-deploy smoke run and the restore test cover what really does
vary per environment.

## 12. Operating a laptop as a server

- **Disks.** Docker's data-root and containerd's root both live on `/srv`.
  `docker info` reporting `/srv/docker` doesn't prove images moved, because
  with the containerd snapshotter the layers live under `/var/lib/containerd`.
  Check with `df -h /var /srv`. Set journald `SystemMaxUse=1G`.
- **Battery.** Hold the charge at about 80%: ThinkPad
  `charge_control_end_threshold` via TLP, or IdeaPad conservation mode. A
  battery held at 100% around the clock ages quickly and can swell.
- **Power loss.** The battery is a small UPS. Alert on AC loss, and let upower
  shut the host down cleanly at about 15%.
- **Heat.** Give it airflow, and never stack it. Alert on sustained high
  throttling (§8.2). Reindexing capped at 4 threads helps.
- **Suspend.** Suspend on lid close is off: a logind drop-in plus masked sleep
  targets, already in place.
- **Network.**
  - wired Ethernet;
  - a DHCP reservation, pending with IT;
  - an internal DNS name, never an IP, because the certificate and the OIDC
    redirect URI bind to it.
- **Updates.** unattended-upgrades for security fixes. A monthly window for
  Docker and the kernel, with a reboot, which also tests unattended boot. The
  Postgres image changes only through a pinned-tag bump followed by a restore
  test.
- **Provisioning as code.** Everything in this section goes into an idempotent
  Ansible playbook under `deploy/host/`, run from the operator's machine with
  `--ask-become-pass`:
  - users, SSH, the firewall and Docker;
  - the downloader logins and the SFTP chroot, from `backup_downloaders` (§6.2);
  - the systemd units: `tachy.service`, the backup and restore-test timers,
    `tachy-watch` and the heartbeat, the deploy script.

  The RTO for a dead laptop depends on this.

## 13. Phases and exit criteria

### Phase 1: make the laptop safe

**Work**

- **Edge:** Caddy with TLS, the API port removed, and the nftables firewall.
- **Compose:** a `deploy/compose.prod.yml` override with the limits from §4.3,
  `init`, hardening, the `local` log driver and `stop_grace_period`. The dev
  stack is removed from the laptop.
- **Postgres:** the conf file for 16 GB, a pinned image, roles and grants in
  `schema.sql`, per-process `DATABASE_URL`, pool size, `idle_timeout` and
  `application_name` by env in `core/src/infra/db.ts`, and an
  `analysis_runs(created_at)` index.
- **API:**
  - `/livez`, `/readyz` and a warm model;
  - the SIGTERM drain in `api/src/index.ts`;
  - admission control by slots (cap 15, 1 active turn per user, 409 with the
    running turn's id) and the SSE keepalive in `routes/agent.ts`;
  - a turn whose stream closes with no approval pending is aborted after 30 s;
  - one embedding model in a worker thread, with a query queue ahead of a
    passage queue, `POST /internal/embed` and `TACHY_EMBED_URL` for the MCP
    children (§5.4);
  - the passage batch reduced from 32 to 8;
  - the MCP entry point compiled to JavaScript, with a 256 MB heap cap;
  - the `runtime` block on `/api/system` (§8.1);
  - `TACHY_UPLOAD_DIR` set in the image, with an upload sweep.
- **Backups:** the dump, encrypt and publish timer; one SFTP login per
  downloader; `Get-TachyBackup.ps1` with an example connections file; the
  weekly restore test; heartbeats and download alerts (§6).
- **Monitoring:** `tachy-watch` and its timer, the status files, the Teams
  workflow with a co-owner, and the external heartbeat (§8.2).
- **Host:** the `deploy/host/` playbook, covering §12 and the parts of §7 that
  apply to the host.
- **Release:**
  - CI on pushes to `dev` as well as `main`;
  - the GHA image push by SHA;
  - the environment badge moved from `VITE_DEV_BADGE` at build time to
    `TACHY_ENV_BADGE` at runtime (§10);
  - `tachy-deploy <sha>` with automatic rollback;
  - the Jenkinsfile removed.
- **Load:** `load/turns.mjs` and the mock Anthropic API
  (`load/mock-llm/server.mjs`), moved from Phase 2 because the exit criteria
  below need them.
- **Hygiene:** `smoke.js` extended to the wiki, library images and admin
  routes; the load-test user, excluded from engagement analytics; Dependabot
  fixed; k6, node and pgvector pinned; `report.*.json`
  added to `.gitignore`; and README, `.env.example` and this document kept
  accurate.

**Exit when:**

- only 443 is reachable from the LAN, and SSO works over https;
- stopping `api` during a turn lets the turn finish or fail cleanly inside the
  grace period, and `docker events` shows no SIGKILL;
- 15 concurrent mock turns run in a load window with api memory under 85% of
  its limit, and a 16th queues;
- `turns.js` measures a Claude turn at 0.55 GB or less at p95;
- at least two people have downloaded a set with `Get-TachyBackup`; a restore
  from a laptop copy has been done and timed; and the weekly restore test has
  been green for 2 weeks;
- every check in §8.2 has posted to Teams at least once (by forcing its
  threshold), and unplugging the network trips the external heartbeat;
- a deliberately broken image rolls itself back;
- the same digest runs on the dev and production stacks: dev shows the `dev`
  badge, and production shows none;
- a reindex of the largest linked repo while `smoke.js` runs against production:
  smoke still passes.

### Phase 2: separation on one host

**Work**

- the job layer (§5.3): `defineJob` and the registry, `job_definitions`,
  `job_runs` and `job_definition_changes`, the scheduler, `worker-light` and
  `worker-heavy`, and the first kinds: `repo.reindex`, `source.sync`,
  `embeddings.backfill`, `retention.sweep`, `wiki.gaps`;
- the admin jobs UI: definitions with generated forms, schedule preview, run
  history, run now, cancel;
- the admin surface in §5.13;
- the embed queue moved out of the api into an `embedder` service; the worker
  uses it at low priority;
- uploads moved into Postgres;
- the compiled build for everything, with no `tsx` at runtime;
- the `container-smoke` and `schema-plan` CI jobs;
- the schema-diff spike, adoption, and the matching CONTRIBUTING.md update;
- k6 `contention.js`;
- the admin `tests` section: checks, `test_runs`, the load-test runner and its
  guardrails (§11.3);
- key ids for the vault.

**Exit when:**

- `contention.js` holds search p95 within 1.5× the baseline during a reindex;
- the slot cap has been raised from measurements, or the reason it can't be is
  written down (§3.2);
- a schema change has shipped by diff, without a dump and restore;
- one request id can be followed across api and MCP log lines with
  `docker compose logs`;
- both new CI jobs are required checks.

### Phase 3: department server (profile B)

**Work**

- the `agent` service with `turns` and `turn_events`, resumable SSE, and
  approvals through the database;
- a stateless API ×2 under `docker-rollout`;
- Postgres on its own host, with pgBackRest;
- a replacement-host drill.

**Exit when:**

- an API redeploy during a turn doesn't interrupt it: the client resumes with
  `?after=N`;
- a point-in-time restore has been rehearsed;
- a replacement host is running within 1 h;
- k6 sees no 5xx during a rolling deploy.

### Phase 4: higher availability (profile C)

**Work**

- a second application host behind keepalived;
- a Postgres standby and a promotion runbook;
- quarterly drills;
- tracing, only if an incident couldn't be explained without it.

**Exit when:**

- a standby promotion completes in 15 minutes or less;
- losing an application host moves traffic through the VIP;
- the RPO and RTO targets in §6 have been demonstrated.

## 14. Runbooks to write

**Setup**

- First installation and bootstrap, from `deploy/host/` through to the setup
  wizard.
- Adding a team, a source connection, a linked repo.

**Releases**

- Deploy, roll back, and read the deploy log.
- Schema change: reading the plan, destructive changes, expand and contract.
- Draining before maintenance.

**Credentials**

- Rotating the session secret, the API token, source tokens, provider keys, and
  the vault key.

**Recovery**

- Adding or removing a downloader, and setting up `Get-TachyBackup` on a
  Windows laptop.
- Backup verification, and restoring from a laptop copy onto the same host or a
  replacement.
- Rotating the team backup key.
- Replacing a failed laptop or server.
- Recovering from a full disk, including the `/var` partition.

**Upgrades**

- Upgrading Postgres (major version, pgvector version).
- Changing the embedding model and re-embedding.

**Investigation**

- A slow search, a stuck or expensive turn, a failed sync, a failed index.

**Housekeeping**

- Certificate renewal, when not automatic.
- Log, transcript and upload retention.
- Incident ownership and escalation.

## 15. Open questions and decisions

### 15.1 Decided (2026-09-17)

- **Laptop.** Measured 2026-09-17:
  - ThinkPad E14 Gen 2, i7-1165G7 (4 cores, 8 threads, 400–4700 MHz), 15 GiB
    usable RAM, 976 MB swap. The whole stack uses about 420 MB at idle (api
    286 MiB, postgres 137 MiB).
  - Samsung 512 GB NVMe: `/` 30 G, `/var` 12 G (40% used, 3.8 G of it
    containerd), `/srv` 432 G. SMART: 1% used, 0 media errors, 603 power-on
    hours, **24 unsafe shutdowns**, so it has lost power or been forced off
    before, and the clean-shutdown work in §12 matters.
  - Gigabit Ethernet with link up, Wi-Fi down. Suspend targets are masked.
  - Battery at 98% of its design capacity after 82 cycles, with
    `charge_control_end_threshold=100`, so the 80% cap from §12 isn't set yet.
  - **Sustained all-core load** (`stress-ng --cpu 8`, 5 minutes, PL1 35 W):
    the package reached 86 °C within 30 s and held at 89 °C, 11 °C below its
    100 °C limit. Throttling began at about 60 s, and the average frequency
    fell from 4100 to 3700 MHz, about 10%. The fans barely rose (3200 to 3400
    RPM). After 30 s idle it was back to 50 °C. So the laptop keeps about 90%
    of its peak speed under sustained load, which is fine for embedding bursts.
    The worker's CPU cap (§3) should still keep long reindexes from running
    near the limit for hours.
- **Dump size.** Measured 2026-09-17: the database is 148 MB, and 135 MB of
  that is `code_chunks`. `pg_dump -Fc` gives 52 MB. At this size, `keepSets: 10`
  is about 0.5 GB on a laptop, and the code index stays in the export. Measure
  again once more repositories are linked.
- **Remote access.** LAN only for now. The host is prepared for Tailscale in
  case IT allows it: installed, but not joined to a tailnet. Tailscale's free
  Personal plan is "only suitable for non-commercial use"
  ([pricing](https://tailscale.com/pricing)), so this means IT's tailnet or a
  paid plan, not a personal account. The nftables rule for 443 and 22 then adds
  the `tailscale0` interface.
- **Downloads from home.** Allowed over Tailscale, once it exists. Each
  downloader's `from=` then covers the office LAN and `100.64.0.0/10`, the
  tailnet's address range.
- **Alerts.** Microsoft Teams, through a Workflows webhook. It needs no Entra
  app registration. Microsoft 365 Connectors "are nearing deprecation, and the
  creation of new Microsoft 365 Connectors will soon be blocked", and the
  replacement is the **When a Teams webhook request is received** trigger
  ([docs](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook)).
  `tachy-watch` posts to that workflow URL with `curl` (§8.2). Two caveats:
  - "Workflows are linked only to specific users", so give the workflow a
    co-owner, or it goes orphaned when its owner leaves;
  - the Workflows app must be allowed in the tenant, which is an IT question.

  The webhook URL is a secret, so keep it in the password manager.

- **Registry.** GHCR under the personal GitHub account.
  - Public packages are free. Private ones come with 500 MB of storage and 1 GB
    of transfer, but "Container image storage and bandwidth for the Container
    registry is currently free"
    ([docs](https://docs.github.com/en/billing/concepts/product-billing/github-packages)).
    "Currently" is the risk: if that changes, move to the private Docker Hub
    repository.
  - The workflow pushes with `GITHUB_TOKEN`. The laptop pulls with a classic
    personal access token carrying only `read:packages`
    ([docs](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)).
  - The limit per layer is 10 GB, so the model layer fits.
- **Cloud or NAS.** None. The laptops of the downloaders are the off-host copy.
- **Dev stack off the laptop.** The laptop runs production only. Laptop
  numbers come from load windows against a restored copy (§11.1). Where the dev
  stack goes instead is still open (§15.2).
- **No metrics stack.** No Prometheus, Grafana, Loki or exporters. Monitoring
  is the admin page, `tachy-watch` and an external heartbeat (§8).
- **Jobs (§5.3).** Kinds are defined in code and configured in the UI. Scripts
  are never uploaded or run from the UI. Resources are fixed classes backed by
  worker pools (`light`, `heavy`). Only global admins configure jobs.
- **Concurrent turns.** 15 slots to start, from measurements (§3). The
  prerequisite is one embedding model per host (§5.4).
- **Load-test windows.** Against production:
  - `smoke.js` at any time;
  - `browse.js`, `search.js` and `contention.js` only on weekdays 19:00–07:00
    or at weekends, and only when a release needs the numbers;
  - never `soak.js`, `spike.js`, `breakpoint.js` or `PROFILE=stress`. Those
    run only against the dev stack;
  - `turns.js`, only in a load window, against `api-load` and the mock LLM,
    never against production itself (§11.1).
- **TLS.** Caddy's internal CA to start. Clients install its root once
  (`deploy/runbooks/tls-client-trust.md`), and `caddy-data` is backed up so a
  lost volume never forces a reinstall everywhere. An IT-issued certificate is
  one `.env` change (`TACHY_TLS`) whenever IT provides one.
- **External heartbeat.** healthchecks.io, one check each for backups, the
  restore test and `tachy-watch`.
- **Copilot.** Kept, and counted as 4 chat slots until a turn is measured.
- **Admin page names.** `connect` becomes `integrations` (sources, projects,
  repos, jobs), and a `system` page holds runtime, backups, monitoring,
  release, tests, host and system settings (Phase 2).
- **Password login under SSO.** Only for accounts flagged
  `password_login_allowed`: one break-glass admin and the load-test user.
  Service accounts (`service_account`) are left out of engagement figures.
- **Job notifications.** A second Teams workflow URL stored in the vault;
  `tachy-watch`'s URL stays on the host.
- **Usage counter retention.**
  - `library_views` and `mcp_tool_calls` keep per-person, per-day rows for 13
    months, which is enough to compare a month with the same month a year
    earlier.
  - After that, a monthly sweep rolls them up to one row per item or tool, per
    month, with no `user_id`.
  - `source_calls` holds no person and grows only by connections × days × 3, so
    it is kept.
- **Transcript retention.** "Transcripts" here means the Claude Code session
  files in the `tachy-agent-home` volume, one per chat, under `users/<id>/`.
  They hold every prompt, tool call and tool result, including customer ticket
  content, and they are what lets a chat be resumed. Keep 90 days from last
  activity, then delete them. The chat record and its counts in
  `analysis_runs` stay. Whether Claude Code's own `cleanupPeriodDays` already
  deletes them is **to verify**: tachy passes `settingSources: []`
  (`agent/src/claude.ts:151`), so the default applies.

### 15.2 Still open

- **Name.** The internal DNS name, and whether IT will later issue a
  certificate for it. TLS itself is decided (§15.1); the notes below are the
  options if the internal CA is ever replaced.
- **Entra app registration.** SSO needs a client id and secret registered by
  someone allowed to, with the redirect URI `https://<name>/auth/callback`.
- **Name and TLS, the options.** This isn't optional. Entra accepts only `https` redirect
  URIs except for localhost, and without TLS, passwords and session cookies
  cross the LAN in clear text anyway. One question for IT decides the route:
  1. **An internal CA whose root is already on company laptops** (for example
     AD CS): IT issues one certificate for the name. Clients trust it with no
     further work, and renewal is manual, usually yearly.
  2. **A company DNS zone with an API token for one subdomain:** Caddy gets a
     publicly trusted certificate by DNS-01 and renews it itself. The hostname
     appears in public Certificate Transparency logs.
  3. **Tailscale, if adopted:** `tailscale cert` issues a Let's Encrypt
     certificate for the `*.ts.net` name, which is also published in
     Certificate Transparency logs, and renewal is the operator's job
     ([docs](https://tailscale.com/kb/1153/enabling-https)). It only works for
     people on the tailnet.
  4. **Otherwise,** Caddy's internal CA, with its root installed by hand on
     every client.

  Whichever it is, use one hostname on the LAN and the tailnet, so the cookie
  and the Entra redirect URI stay the same.

- **Webhooks from sources.** Proposed: no, not while the host is LAN-only.
  Syncs on a schedule decide freshness. The event trigger stays internal
  (§5.3.3), so inbound webhooks can be added later as one more way to queue a
  run.
- **RAM upgrade.** A 32 GB DDR4-3200 SO-DIMM in place of the current 16 GB
  module, the laptop's documented maximum. Everything in §3 is planned to work
  without it; with it, the turn cap can reach about 40.
- **Where the dev stack lives.** It needs a machine that is on during working
  hours and reachable by the people testing. In order of preference:
  1. a small second machine in the office, such as a mini PC or a retired
     laptop with 16 GB. It deploys `dev` the same way as production, and
     behaves like it;
  2. the developer's workstation, as a stopgap. It's only up while the
     developer is, and the `tachy-api` container already running there is a
     personal development instance, so the dev stack would need its own
     Compose project and ports;
  3. a small cloud VM. It works, but it puts company data outside the office,
     which the no-cloud decision (§1) rules out for now.
- **Downloaders.** Which two people. Disk space is no constraint at the
  current dump size.

## 16. Implementation status

Built on 2026-09-17 as one branch per pull request, stacked in this order, each
based on the one before. Phase 1 is complete in code; nothing has been run on
the laptop yet.

| #   | Branch                             | What                                                | Verified by                                                                                     |
| --- | ---------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 01  | `feat/deploy-01-ci-hygiene`        | CI on `dev`, pinned k6, Dependabot, Jenkins removed | k6 bundles every script                                                                         |
| 02  | `feat/deploy-02-runtime-env-badge` | `TACHY_ENV_BADGE` at runtime                        | tests                                                                                           |
| 03  | `feat/deploy-03-embed-batch-8`     | passage batches of 8                                | tests                                                                                           |
| 04  | `feat/deploy-04-db-pools-roles`    | pools by env, `db/roles.sql`, conf, pinned pgvector | fresh volume: `tachy_app` logs in, cannot create a table                                        |
| 05  | `feat/deploy-05-health-drain`      | `/livez`, `/readyz`, schema stamp, SIGTERM drain    | SIGTERM on a live server drains and exits                                                       |
| 06  | `feat/deploy-06-embed-worker`      | one model in a worker thread, `/internal/embed`     | MCP child after a search: 1144 MB → 118 MB                                                      |
| 07  | `feat/deploy-07-mcp-compiled`      | esbuild MCP bundle, 256 MB heap cap                 | child 107 MB, starts in ~130 ms                                                                 |
| 08  | `feat/deploy-08-turn-admission`    | slot cap, queue, one turn per user, stop, keepalive | route tests; real CLI: cap 2, 5 turns, 3 queued, all finished                                   |
| 09  | `feat/deploy-09-uploads-dir-sweep` | per-user uploads, TTL sweep                         | tests                                                                                           |
| 10  | `feat/deploy-10-admin-runtime`     | runtime block in `/api/system`                      | tests                                                                                           |
| 11  | `feat/deploy-11-load-turns-mock`   | mock LLM, `load/turns.mjs`, MCP log shipping        | real turns against the mock; `mcp_tool` lines reach the api log                                 |
| 12  | `feat/deploy-12-compose-prod`      | `deploy/compose.prod.yml`, Caddy                    | built image: TLS, `/internal` 404, read-only turn, `docker stop` mid-turn sends only SIGTERM    |
| 13  | `feat/deploy-13-ghcr-publish`      | image by commit to GHCR                             | actionlint                                                                                      |
| 15  | `feat/deploy-15-load-hygiene`      | service accounts, SSO-only passwords, fuller smoke  | tests; smoke 19/19 against a seeded server                                                      |
| 16  | `feat/deploy-16-backups`           | `tachy-backup`, `Get-TachyBackup.ps1`               | backup + restore test on a seeded stack; drift fails it; PowerShell 7 against an SFTP container |
| 17  | `feat/deploy-17-tachy-watch`       | `tachy-watch`                                       | posts, escalation, reposts and `--force` against a capture server                               |
| 18  | `feat/deploy-18-tachy-deploy`      | `tachy-deploy`                                      | good deploy, broken image rolls back, schema change refused                                     |
| 19  | `feat/deploy-19-host-playbook`     | Ansible playbook                                    | syntax check, ansible-lint, `sshd -t`, `nft -c`, rules applied twice in a container             |
| 20  | `feat/deploy-20-docs-runbooks`     | runbooks, README, this section                      | —                                                                                               |

PR 14 in the plan (the turn load test) landed with PR 11. Still to verify on the
laptop: the sshd log wording `tachy-watch` parses for downloads, and
`Get-TachyBackup.ps1` under Windows PowerShell 5.1.
