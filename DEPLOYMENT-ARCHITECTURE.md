# tachý deployment architecture

Reviewed against `dev` @ `a1eb0b9` on 2026-09-11. File references point at that
commit. Where a claim depends on a third party's behaviour, the source is
linked or the claim is marked **to verify**.

## 1. Scope

How tachý is deployed, operated and grown. There are three profiles:

- **A. Office laptop.** Debian 13, 32 GB RAM, 500 GB disk, running now.
- **B. Department server.** A dedicated host for Postgres, one for the
  application, and one for operations.
- **C. Higher availability.** Two application hosts and a Postgres standby.

This is an architecture document, not an implementation spec. Every item in §13
becomes its own pull request. Decisions already taken:

- Docker Compose on every profile up to and including B. No Kubernetes.
- Postgres is the only stateful service. No Redis, no MinIO.
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
|-- timers: turn sweep (60 s), generated-output sweep (1 h)
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

### 2.2 Where state lives

| State                      | Location                                                                                                | Durable?                          | With two API replicas                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------- |
| System of record           | Postgres volume                                                                                         | yes                               | fine                                                                                     |
| Generated exports          | `generated_outputs.bytes` in Postgres, TTL 24 h, hourly sweep (`routes/outputs.ts:13`)                  | until TTL                         | fine; the sweep is idempotent                                                            |
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
  SSH to a placeholder host (`Jenkinsfile:6`). Its production stage runs
  `compose pull && up -d api` without updating the checkout, so
  `docker-compose.yml` and `db/schema.sql` on the host can drift from the
  image. It is not in use.
- GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, `web:check` and
  `coverage`, and on pull requests it bundles the k6 scripts without running
  them.
- A second, dev stack shares the laptop's CPU and RAM (README, Deployment).
- The API publishes `0.0.0.0:8787` over plain HTTP. Postgres binds to
  `127.0.0.1`.

### 2.4 What fails first

HTTP throughput is not on this list. Thirty people generate a few requests a
second.

1. **RAM, from concurrent turns.** Nothing caps them, and each one is a CLI
   process, an MCP child and possibly a model copy. A Node diagnostic report
   left in the repo root (`report.20260911.005018.52770.0.001.json`, from a
   developer machine) shows a Copilot runtime dying at its 4 GB heap limit,
   with 4.7 GB RSS.
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

## 3. Capacity model (profile A, 32 GB)

The per-turn figures here are **estimates**. `load/turns.js` (§11) replaces
them with measurements, and the admission cap follows from those numbers.

| Per chat turn               | Phase 1                | Phase 2 (embedder)      |
| --------------------------- | ---------------------- | ----------------------- |
| Claude Code CLI or Copilot  | measure; budget 0.4 GB | same                    |
| MCP child (Node, tsx, core) | measure; budget 0.2 GB | lower once compiled     |
| MCP child's model copy      | about 0.4–0.6 GB       | none; it calls embedder |
| Postgres connections        | up to 10               | at most 3               |
| **Budget per turn**         | **1–1.5 GB**           | **about 0.5 GB**        |

| Memory (GB)                   | Phase 1 | Phase 2 |
| ----------------------------- | ------: | ------: |
| OS, Docker, page-cache floor  |       4 |       4 |
| postgres (`shared_buffers` 4) |       8 |       8 |
| api, including up to 6 turns  |      10 |       5 |
| embedder                      |       — |       2 |
| worker                        |       — |       3 |
| observability                 |       2 |     2.5 |
| caddy                         |     0.1 |     0.1 |
| dev stack, capped             |       3 |       3 |
| headroom                      |    ~4.9 |    ~4.4 |

Limits are ceilings, not reservations. Memory a container leaves unused goes to
page cache, which Postgres relies on.

**Expected turn demand:** 30 users × ~10 turns a day gives about 60 turns in the
peak hour. At ~2 minutes per turn that averages 2 concurrent, with peaks of 5–6.
A global cap of 6, with a short queue, covers it. Confirm this once `turns` has
start and end timestamps. `analysis_runs` records only the finished result.

**CPU:** the core count is still open (§15), so allocation is by weight.
`api`, `embedder` and `postgres` get high `cpu_shares`. `worker` and the dev
stack get low shares and a hard `cpus` cap of at most half the cores. Sustained
all-core embedding throttles a laptop, so watch frequency and temperature (§12).

**Disk (500 GB):** alert at 80% on every mount separately. The large consumers
are Postgres, repo clones, dump staging (three dumps' worth), images (the last
three releases), and metrics and log retention.

## 4. Topology

### 4.1 Profile A: laptop

```text
Phase 1 (hardened, same process layout)

LAN/VPN --443--> caddy --> api (turns in-process, capped) --> postgres
host timers: pg_dump -> age -> /srv/tachy/backup-export <-sftp- team laptops
observability: prometheus, grafana, alloy, postgres_exporter, blackbox

Phase 2 (separated)

LAN/VPN --443--> caddy --> api --+--> embedder  (interactive queries)
                                 +--> postgres <-- worker (jobs; own model,
                                 |                         low CPU weight)
                                 `--> turn trees --> MCP --> embedder, postgres
```

### 4.2 Services and replicas

| Service       | A · Phase 1     | A · Phase 2    | B · server         | C · HA                          |
| ------------- | --------------- | -------------- | ------------------ | ------------------------------- |
| caddy         | 1               | 1              | 1                  | 1 per app host, behind a VIP    |
| api           | 1 (runs turns)  | 1 (runs turns) | 2, stateless       | 2+ across hosts                 |
| agent         | —               | —              | 1–2                | 1+ per app host, sticky by user |
| embedder      | — (inside api)  | 1              | 1–2                | 1 per app host                  |
| worker        | — (api and cli) | 1              | 1–2                | 1+, cron under a leader lock    |
| postgres      | 1               | 1              | 1, on its own host | primary and standby             |
| observability | same host       | same host      | ops VM             | ops VM                          |

### 4.3 Phase 1 limits on the laptop (starting values)

Set with Compose's service attributes: `mem_limit`, `cpus`, `cpu_shares` and
`pids_limit`.

| Service       | mem_limit   | CPU                   | pids_limit | Other                                            |
| ------------- | ----------- | --------------------- | ---------- | ------------------------------------------------ |
| caddy         | 256m        | 1024 shares           | 256        | the only published ports, 80 and 443             |
| api           | 10g         | 2048 shares, no cap   | 1024       | `init: true`, `stop_grace_period` = drain + 30 s |
| postgres      | 8g          | 2048 shares           | —          | `shm_size: 1g`, tuned conf (§5.9)                |
| observability | 0.5–1g each | 256 shares, `cpus: 1` | 256        |                                                  |
| dev stack     | 3g in total | 128 shares, `cpus: 2` | 512        | or moved off the laptop                          |

### 4.4 Profile B: department server

- **Application host (Compose):** caddy, api ×2, agent, embedder, worker.
- **Database host:** Postgres and pgBackRest.
- **Ops VM:** Prometheus, Grafana, Loki, blackbox.
- **Backups:** a pgBackRest repository on separate storage. Team laptops keep
  pulling the encrypted dumps (§6.2) until a cloud or NAS target exists.

**Portability.** If "more professional" turns out to mean a cloud VM, the same
images run on any Docker host. Managed Postgres works if the service offers
`vector`, `pg_trgm` and `pgcrypto` (**to verify** on the chosen service), and
then only `DATABASE_URL` changes. The hard constraint is the turn process tree:
turns spawn subprocesses and need roughly 0.5–1.5 GB each. That rules out
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
- `LISTEN` connections or NOTIFY latency showing up as pressure in the Postgres
  dashboards.

Even then, Redis stays a cache and a bus, never the only copy of a job's
history.

### 5.3 Postgres-backed jobs, and a worker

**Decision.** A `jobs` table in `db/schema.sql`, and a `worker` service that
runs the same image with a different command.

- **Columns:** `kind`, a dedupe `key` (a unique partial index on active rows),
  `payload`, `status`, `attempts`/`max_attempts`, `run_after` (backoff),
  `locked_by`/`locked_until` (a lease the worker extends by heartbeat),
  `progress`, `last_error`, and timestamps.
- **Claiming:** `update … where id = (select … for update skip locked limit 1)`.
  A reaper requeues expired leases.
- **Cron:** runs only on the worker that holds `pg_try_advisory_lock`, so
  schedules fire once however many workers run.
- **Kinds:** repo reindex, source sync per connection schedule, embedding
  backfills, and retention sweeps (outputs, uploads, transcripts,
  `turn_events`).

**Why.** It extends what is already there: `repos.index_status`
(`db/schema.sql:847`), `sweepInterruptedIndexes` (`core/src/code/repos.ts:218`)
and `source_connections.last_synced_at`. It also takes indexing out of the
request process. The admin PipelinePanel can show job state directly.

**Alternative.** pg-boss, if the in-house version grows past a few hundred
lines. It keeps its own schema outside `schema.sql`, which is the cost.

### 5.4 An embedder service for interactive queries

**Decision.** An internal `embedder` service (same image) that holds one model
with bounded concurrency. `core/src/search/embeddings.ts` gains a
`TACHY_EMBED_URL` switch, which the API and every MCP child use. The worker
keeps a local model and runs at a lower CPU weight.

**Why.** It takes about 0.5 GB and the model-load latency off every turn. It
also separates interactive from batch embedding at the cgroup level instead of
inside one event loop.

**Revisit.** If `turns.js` shows turns rarely search, which is unlikely given
the consult flow.

### 5.5 Agent turns: admission control now, an agent service later

**Phase 1, still in the API process:**

- a global cap of about 6 turns and 1–2 per user;
- beyond the cap, a `queued` SSE event with a queue position; past a short
  queue, 429;
- `NODE_OPTIONS=--max-old-space-size` for the Node children;
- a pool of `max: 3` for the MCP child, set by env in `db.ts`;
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
from `pg_stat_statements` and the dashboards:

| Setting                               | Value                | Why                                     |
| ------------------------------------- | -------------------- | --------------------------------------- |
| `shared_buffers`                      | 4GB                  | HNSW indexes want to stay in memory     |
| `effective_cache_size`                | 10GB                 | what the page cache realistically holds |
| `maintenance_work_mem`                | 1GB                  | HNSW builds and reindexing              |
| `work_mem`                            | 32MB                 | facets and ranking sorts                |
| `random_page_cost`                    | 1.1                  | NVMe                                    |
| `max_connections`                     | 100, explicit        | sized to the pools below                |
| `shared_preload_libraries`            | `pg_stat_statements` | slow-query visibility                   |
| `log_min_duration_statement`          | 500ms                |                                         |
| `idle_in_transaction_session_timeout` | 60s                  |                                         |
| `wal_compression`, `max_wal_size`     | on, 4GB              | fewer checkpoints during bulk embedding |

Also set `shm_size: 1g` in Compose, since Docker's default `/dev/shm` is 64 MB.
Pin the image to a pgvector version as well as a Postgres major: the floating
`pg16` tag can change the extension under a running database.

**Pools,** per process type:

| Process   | Pool `max` |
| --------- | ---------: |
| api       |         15 |
| worker    |          5 |
| MCP child |          3 |
| cli       |          5 |
| exporter  |          2 |
| grafana   |          2 |

**Roles,** created in `db/schema.sql`:

| Role             | Used by                   | Rights                                                                              |
| ---------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `tachy_owner`    | schema apply              | owns every object                                                                   |
| `tachy_app`      | api, worker, MCP children | DML on application tables, `statement_timeout` (the worker raises it for long jobs) |
| `tachy_readonly` | Grafana                   | `select` on reporting tables, **never** on `credentials`                            |
| `tachy_backup`   | `pg_dump`                 | `pg_read_all_data` (Postgres 14+)                                                   |

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

## 6. Durability, backup, restore

| Profile | RPO                                                                                                                      | RTO      | Mechanism                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------- |
| A       | bad write or corruption: ≤ 6 h. Host lost: the age of the newest laptop copy, at most 7 days if the reminder is acted on | ≤ 4 h    | encrypted `pg_dump` every 6 h; people download it over SFTP now and then; host rebuilt from `deploy/host/` |
| B       | ≤ 5 min                                                                                                                  | ≤ 1 h    | pgBackRest WAL archiving to separate storage; laptop downloads continue                                    |
| C       | ≈ 0 for host loss, ≤ 5 min for bad writes (PITR)                                                                         | ≤ 15 min | streaming standby and a promotion runbook                                                                  |

**What gets backed up**

| Item                                    | Backed up? | Notes                                                                                                                                              |
| --------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres                                | yes        | exclude table data for `generated_outputs` (24 h downloads) and, later, `turn_events`                                                              |
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
7. The run records the newest backup's timestamp for the metrics collector, and
   pings its external heartbeat.

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
archives. Ten sets of a 10 GB dump is about 100 GB, so a laptop with 232 GB
free keeps that and stays above its 50 GB floor. Measure the real dump after
the first run (§15). If `code_chunks` makes up most of it, leave its data, and
`repo_files`, out of the export. Reindexing rebuilds both, at the cost of a
longer RTO.

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

- **Host:** the newest backup's age, as a metric. Alert when it passes 7 h.
- **Downloads:** each downloader's transfers show up in the sftp-server INFO
  log, under their own login. Alloy reads it from the journal, which gives the
  last download for each person. The exact log line format is **to verify** on
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
  line with the 25 MB upload cap.

**Containers**

- `init: true`, and `USER node` (already in place).
- `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`, and
  `read_only: true` with a tmpfs for `/tmp`.
- `pids_limit` on every service. It is the backstop for runaway turn trees.
- No container mounts the Docker socket. Alloy reads container logs through a
  read-only socket proxy that allows only listing containers and reading logs.
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
  because it holds counts, not content.
- Backups leave the host only as age ciphertext, and the key that opens them
  lives only in the password manager (§6.1).
- Every HTTP log line carries the user's email (`api/src/logging.ts:50`). That's
  fine operationally, so restrict access to Loki and Grafana. Bodies and tokens
  are never logged, and that must stay true.
- Egress the host needs:
  - the model providers (Anthropic, GitHub Copilot);
  - the sources (Freshdesk, GitHub, Azure DevOps) and the linked git remotes;
  - Hugging Face only at build time, because the model is baked into the image.

  Once that list is stable, an allow-list at the office firewall is an option.

## 8. Observability

### 8.1 Signals

**Application metrics.** `prom-client` serves `/metrics` on an internal port
that Caddy doesn't route.

- `http_request_duration_seconds{method,route,status}`. `route` is the matched
  pattern from Hono's `routePath` helper (`hono/route`), never the raw path:
  ids in paths make the cardinality unbounded.
- `tachy_sse_streams`.
- `tachy_turns_active{provider}`, `tachy_turns_queued`,
  `tachy_turn_duration_seconds{provider,outcome}` and
  `tachy_turn_admission_rejected_total`.
- `tachy_approvals_pending` and `tachy_approval_wait_seconds`.
- `tachy_embed_duration_seconds{kind}` and `tachy_embed_inflight`.
- Node defaults: event-loop lag, heap, RSS, GC.
- postgres.js exposes no pool statistics. Connections are observed from the
  database side instead.

**Turn children.** The short-lived MCP children can't be scraped. They already
log an `mcp_tool` line with timings for every call (`mcp/src/server.ts:24`). But
tachy sets no `stderr` callback on the agent SDK, whose `stderr` option is
documented only as a "Callback for stderr output from the Claude Code process"
(`sdk.d.ts`). So whether these lines reach the container log at all is **to
verify**. If they don't, the child should log to a file that Alloy tails.

**Business metrics.** Grafana reads Postgres directly as `tachy_readonly`:

- turns a day, and tokens and cost per user and team (`analysis_runs`, with
  `meta.cost_usd`);
- knowledge approvals;
- sync lag (`source_connections.last_synced_at`);
- repo index status.

`analysis_runs` needs an index on `created_at` for these queries.

**Collection.** Grafana Alloy is the single agent. It covers:

- host metrics: filesystems per mount (`/var` and `/srv` separately), hwmon
  temperatures, CPU frequency, `power_supply` for AC and battery;
- container metrics, where memory against its limit is the capacity signal,
  since turn trees live in the api container's cgroup;
- container logs, shipped to Loki from Phase 2.

Also run postgres_exporter (connections by state and role, locks, transaction
age, sizes) and smartctl_exporter for NVMe health. A blackbox exporter probes
`https://<host>/readyz` through Caddy, which exercises TLS and the whole path,
and records certificate expiry.

**Logs.** Use the Docker `local` log driver, which is compressed and rotated,
starting now. Loki arrives in Phase 2:

- labels: `service`, `container`, `level` and `event`. `event` is a fixed
  vocabulary: `http`, `mcp_tool`, `repo_index_failed` and so on.
- request, turn and user ids stay as JSON fields, never labels.
- retention: 14 days.

**Tracing.** Deferred. Revisit only when turn latency can't be explained from
logs and metrics.

### 8.2 SLOs and alerts

| SLO                                                   | Target                |
| ----------------------------------------------------- | --------------------- |
| Availability (`/readyz` via blackbox), 08–19 weekdays | 99.5% a month         |
| Non-search API latency                                | p95 < 300 ms          |
| Knowledge and reference search                        | p95 < 1.5 s           |
| Source sync freshness                                 | lag < 2× the schedule |
| Newest set downloaded to a laptop                     | < 7 days              |
| Last good restore test                                | < 8 days              |

k6 thresholds (§11) and alert rules use these same numbers.

Alerts:

- readyz failing for 2 minutes;
- more than 1% 5xx over 10 minutes;
- search p95 over its SLO;
- turns queued for more than 5 minutes;
- api memory above 85% of its limit;
- event-loop lag p99 over 200 ms;
- more than 80% of Postgres connections in use;
- a transaction older than 10 minutes;
- any filesystem over 80%, with `/var` watched separately;
- a failed or stale backup; nobody has downloaded a set in 7 days; fewer than 2
  people have downloaded in 30 days; a failed restore test (§6.3);
- a certificate expiring within 14 days;
- CPU above 90 °C, sustained;
- AC power lost;
- NVMe SMART warnings;
- jobs in `error` state, or the oldest queued job older than 30 minutes
  (Phase 2).

**Delivery.** Grafana alerting sends to one contact point (§15).

**Dead-man's switch.** Monitoring on the laptop can't report the laptop's own
death. A host timer pings an external healthchecks check every few minutes
while readyz answers, and each backup and restore-test run pings its own check.
If the pings stop, the external service raises the alarm.

### 8.3 Dashboards

- **Service:** request rate, errors and duration per route; SSE streams; turns;
  event loop.
- **Capacity:** container memory against limit, active turns against the cap,
  CPU per container, temperatures and throttling.
- **Postgres.**
- **Jobs and freshness:** sync lag, index state, backup age, each downloader's
  last download, and restore age.
- **Usage and cost,** from `analysis_runs`.
- **k6 runs,** per release.

## 9. Health, readiness and shutdown

**Probes**

- `/livez`: the process is up, nothing else. Docker's HEALTHCHECK uses it.
- `/readyz`: the database answers, the schema matches what the image expects,
  the embedding model is warm (load it at boot, not on the first search), and
  the process isn't draining. Caddy's upstream check and the blackbox probe use
  it.
- Keep `/health` as an alias of `/livez` for existing probes. Detailed
  diagnostics are admin-only, under `/api/admin/system`.

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
optional.

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

**Dev stack.** The same flow, from `dev` into `/opt/tachy-dev`. Better still,
move it off the laptop (§11).

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

**Where load runs.** Never against production while people are using it. The
dev stack shares the laptop, so staging is either the dev stack moved to
another machine, or an agreed off-hours window. Seed with `--embed=search`.
Synthetic vectors make the vector leg contribute nothing (`load/README.md`).

**Results.** Send them with the Prometheus remote-write output
(`-o experimental-prometheus-rw`, **to verify** against the pinned k6 version)
into the same Prometheus. Tag runs with the image SHA and compare release to
release.

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
  temperature or throttling. The worker's CPU cap helps.
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
  - the systemd units: `tachy.service`, the backup and restore-test timers, the
    heartbeat, the deploy script.

  The RTO for a dead laptop depends on this.

## 13. Phases and exit criteria

### Phase 1: make the laptop safe

**Work**

- **Edge:** Caddy with TLS, the API port removed, and the nftables firewall.
- **Compose:** a `deploy/compose.prod.yml` override with the limits, `init`,
  hardening, the `local` log driver, `stop_grace_period`, and a capped dev
  stack.
- **Postgres:** the conf file, `shm_size`, a pinned image, roles and grants in
  `schema.sql`, per-process `DATABASE_URL` and pool size by env in
  `core/src/infra/db.ts`, and an `analysis_runs(created_at)` index.
- **API:**
  - `/livez`, `/readyz` and a warm model;
  - the SIGTERM drain in `api/src/index.ts`;
  - admission control and the SSE keepalive in `routes/agent.ts`;
  - `/metrics`;
  - `TACHY_UPLOAD_DIR` set in the image, with an upload sweep.
- **Backups:** the dump, encrypt and publish timer; one SFTP login per
  downloader; `Get-TachyBackup.ps1` with an example connections file; the
  weekly restore test; heartbeats and download alerts (§6).
- **Observability:** Prometheus, Grafana (with the Postgres datasource), Alloy,
  postgres_exporter, blackbox, smartctl_exporter, alert rules and a contact
  point.
- **Host:** the `deploy/host/` playbook, covering §12 and the parts of §7 that
  apply to the host.
- **Release:** the GHA image push by SHA, `tachy-deploy <sha>` with automatic
  rollback, and the Jenkinsfile removed.
- **Hygiene:** Dependabot fixed; k6, node and pgvector pinned; `report.*.json`
  added to `.gitignore`; and README, `.env.example` and this document kept
  accurate.

**Exit when:**

- only 443 is reachable from the LAN, and SSO works over https;
- stopping `api` during a turn lets the turn finish or fail cleanly inside the
  grace period, and `docker events` shows no SIGKILL;
- a 7th concurrent turn queues, and api memory stays under its limit;
- at least two people have downloaded a set with `Get-TachyBackup`; a restore
  from a laptop copy has been done and timed; and the weekly restore test has
  been green for 2 weeks;
- each of these alerts has reached the contact point once: api down, disk at
  85%, a stale backup, a certificate under 14 days; and unplugging the network
  trips the external heartbeat;
- a deliberately broken image rolls itself back;
- `seed --embed` on the dev stack while `smoke.js` runs against production:
  smoke still passes.

### Phase 2: separation on one host

**Work**

- the `jobs` table and `worker` service, taking over reindex, sync schedules,
  backfills and sweeps;
- the `embedder` service and `TACHY_EMBED_URL`;
- uploads moved into Postgres;
- Loki;
- the compiled build, with no `tsx` at runtime;
- the `container-smoke` and `schema-plan` CI jobs;
- the schema-diff spike, adoption, and the matching CONTRIBUTING.md update;
- k6 `turns.js` and `contention.js`;
- key ids for the vault.

**Exit when:**

- `contention.js` holds search p95 within 1.5× the baseline during a reindex;
- `turns.js` shows at most 0.6 GB per turn;
- a schema change has shipped by diff, without a dump and restore;
- one request id can be followed across api and MCP log lines in Loki;
- both new CI jobs are required checks.

### Phase 3: department server (profile B)

**Work**

- the `agent` service with `turns` and `turn_events`, resumable SSE, and
  approvals through the database;
- a stateless API ×2 under `docker-rollout`;
- Postgres on its own host, with pgBackRest;
- an ops VM;
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

## 15. Open questions

- **Laptop:** CPU model, core count and thermal behaviour. They set the worker
  cap and the turn cap.
- **Remote access:** LAN only, or a VPN (such as WireGuard) for people working
  remotely.
- **Alerts:** a Teams webhook or email.
- **Name and TLS:** the internal DNS name, and whether a company domain is
  available for DNS-01 or the company CA should issue the certificate.
- **Registry:** GHCR or the private Docker Hub repository, depending on storage
  quota for an image over 1 GB.
- **Downloaders:** which two or more people get a backup login.
- **Downloads from home:** whether downloaders may connect over the VPN, or
  only from the office LAN.
- **Dump size:** measure it after the first run. It sets `keepSets`, and whether
  the code index is left out of the export.
- **Cloud or NAS:** a later target alongside the laptops, not a blocker.
- **Transcript retention:** how long, as a policy.
- **Staging:** where the dev stack lives.
- **Copilot:** its runtime's memory profile, where it keeps session state, and
  whether it can be pointed at a mock.
