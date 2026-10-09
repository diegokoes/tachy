# tachý deployment architecture

Describes the system as of 2026-10-05. File references are paths in that
tree. Where a claim depends on a third party's behaviour, the source is
linked or the claim is marked **to verify**. Measurements keep the date they
were taken.

## 1. Scope

How tachý is deployed, operated and grown. There are three profiles:

- **A. Office laptop.** Lenovo ThinkPad E14 Gen 2, Intel i7-1165G7 (4 cores, 8
  threads), **16 GB RAM**, 512 GB NVMe, Debian 13, running now.
- **B. Department server.** A dedicated host for Postgres, one for the
  application, and one for operations. §4.6 sets out what the application host
  could hold, and what search runs on each size.
- **C. Higher availability.** Two application hosts and a Postgres standby.

This is an architecture document, not an implementation spec. Phases 1 and 2
of §13 are built. What they still need is the laptop: their exit criteria.
Decisions already taken:

- Docker Compose on every profile up to and including B. No Kubernetes.
- Postgres is the only stateful service. No Redis, no MinIO.
- No metrics stack: no Prometheus, Grafana, Loki or exporters. The admin page
  shows the application's own state, a host watch script raises alerts in
  Teams, and an external heartbeat covers the host dying (§8).
- The dev stack doesn't run on the office laptop. The laptop's 16 GB go to
  production.
- `db/schema.sql` remains the only schema source. Upgrades are a declarative
  diff against it, with no migration files.
- GitHub Actions builds the image once. The host pulls it by commit.
- Backups are encrypted on the host. Team members download them now and then
  to their Windows laptops over read-only SFTP. No cloud storage for now.
- Nothing is sized for one host. Memory and CPU limits, pool sizes and worker
  concurrency are variables in `.env`; their defaults are the laptop's (§4.3).

## 2. The system as built

### 2.1 Processes

Production is `docker-compose.yml` with `deploy/compose.prod.yml` over it:

```text
caddy          the only published ports, 80 and 443; /internal answers 404
api            node dist/api.js
|-- Hono: REST under /api, the SPA, SSE, /ingest for bucket pushers,
|         /internal/log for the MCP children
|-- timers: turn sweep (60 s), heavy-job slot poll (10 s),
|           event-loop sampler (60 s), pool watchdog (30 s)
|-- one-shot model calls (report and ticket review): Claude Code, no tools
`-- one tree per chat turn:
    Claude Code CLI (agent SDK query())
    `-- MCP server: node dist/mcp.js
        |-- a postgres.js pool of 2, as tachy_app
        `-- embeds over HTTP at the embedder
embedder       node dist/embedder.js: the one embedding model (§5.4)
worker-light   node dist/worker.js: queues sync, flows, maintenance; 4 runs
worker-heavy   node dist/worker.js: queues index, embed, testing; 1 run; k6
postgres       pgvector/pgvector:0.8.6-pg16, with deploy/postgres/postgresql.conf
cli            profile "tools", ad hoc: sync, backup, restore, reembed, seed
```

- **A turn** starts at `POST /api/agent/chat` (`api/src/routes/agent.ts`).
  - It calls the agent SDK's `query()` (`agent/src/claude.ts`), which starts
    Claude Code.
  - Claude Code gets the MCP server as a stdio command, built in
    `api/src/turn-config.ts`.
- **The MCP child** gets an environment built for that turn (`mcpConfig` in
  `api/src/turn-config.ts`):
  - an allowlist of inherited variables;
  - a pool of 2 with a 30 s idle timeout, and a 256 MB heap cap;
  - the embedder's URL and the internal secret, so it never loads the model;
  - the caller's own source tokens and nobody else's.
- **Embedding** happens in the embedder. A knowledge or reference save still
  waits for its vectors inside the request (`core/src/knowledge/knowledge.ts`,
  `core/src/reference/reference.ts`).
- **Jobs** run in the two workers (§5.3). Three kinds come with a schedule, in
  UTC: `retention.sweep` at 03:30, `repos.refresh` at 02:40 and `wiki.gaps`
  hourly. `source.sync` has none: an admin adds a definition per connection.
- **Model calls outside turns.** `completeOnce` (`agent/src/complete.ts`)
  runs one prompt through `query()` with no tools and no MCP child. Report
  review and ticket review call it in the api, and the `agent.ask` and
  `agent.summarize_item` flow steps call it in `worker-light`. None of them
  takes a chat slot (§2.4). Each call those steps make counts against their
  flow's daily limit (§5.3.7).
- **Usage counting** writes to Postgres without waiting: library views, tool
  calls from each MCP child and source traffic, all through `inBackground`
  (`core/src/infra/background.ts`). The api waits up to 5 s for them when it
  drains (`api/src/index.ts`) and the worker waits too. An MCP child
  has no exit hook, so a count in flight when it exits is lost. That is
  acceptable for counts.

**Without the overlay** (development, CI, `npm run api`) the same image behaves
differently:

- the api holds the model in a worker thread (`api/src/index.ts`);
- the api works jobs itself, one slot per class;
- the api publishes 8787 and connects to Postgres as the superuser;
- outside the image, the MCP child falls back to `tsx` (`turn-config.ts`).

### 2.2 Where state lives

| State                                    | Location                                                                                                              | Durable?                             | With two API replicas                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------- |
| System of record                         | Postgres volume                                                                                                       | yes                                  | fine                                                       |
| Generated exports                        | `generated_outputs.bytes`, TTL 24 h; deleted daily by `retention.sweep`                                               | until TTL                            | fine                                                       |
| Chat uploads                             | `chat_uploads.bytes`, TTL 24 h (`TACHY_UPLOAD_TTL_HOURS`), readable only by their owner                               | until TTL                            | fine                                                       |
| Library images                           | `library_assets.bytes`, deduplicated by sha256, 5 MB cap; orphans removed after 7 days                                | yes                                  | fine                                                       |
| Usage counters                           | `library_views`, `mcp_tool_calls`: per person per day for 13 months, then monthly; `source_calls` is kept             | yes                                  | fine; upserts                                              |
| Jobs                                     | `job_definitions`, `job_runs` (90 days, failed 180), `job_workers`, `job_definition_changes`                          | yes                                  | fine; claims take turns under an advisory lock             |
| Wiki gaps                                | `wiki_gaps`, refreshed hourly by the `wiki.gaps` job                                                                  | yes                                  | fine                                                       |
| Buckets                                  | `buckets`, `bucket_docs`, `bucket_doc_chunks`; the ingest token is stored as a hash                                   | yes                                  | fine                                                       |
| Flows and notifications                  | `flows`, `flow_runs`, `notifications`; old runs and notifications are swept (§7)                                      | yes                                  | fine                                                       |
| Audit trail                              | `audit_events`: sign-ins, account, credential and settings changes, exports. Append-only for `tachy_app`; never swept | yes                                  | fine                                                       |
| Active turns, approvals, admission queue | in-process `Map`s (`api/src/turns.ts`, `api/src/admission.ts`); resolvers in `agent/src/turn.ts`                      | no; a restart drains for up to 180 s | **breaks**: `/approve` must reach the owning process       |
| Maintenance switch                       | an in-process flag (`api/src/lifecycle.ts`)                                                                           | no; a restart clears it              | per replica                                                |
| Claude session transcripts               | `tachy-agent-home` volume, `users/<id>`; pruned after 90 days                                                         | yes                                  | **breaks** `resume` unless shared or routed sticky by user |
| Throttles                                | `Map`s (`api/src/throttle.ts`): failed logins by email, failed ingest tokens by bucket and address                    | no                                   | weaken to per replica                                      |
| Settings                                 | `settings` table; each process re-reads it within 15 s (`core/src/config/settings.ts`)                                | yes                                  | fine                                                       |
| Permission cache                         | 60 s `Map` (`core/src/access/permissions.ts`)                                                                         | no                                   | a role change is stale for up to 60 s elsewhere            |
| Repo clones                              | `tachy-repo-data` volume, mounted in the api and both workers                                                         | rebuildable cache                    | per host                                                   |
| Embedding model                          | image layer (`/app/.model-cache`)                                                                                     | rebuildable                          | fine                                                       |
| Container logs                           | Docker `local` driver, 20 MB × 10 files per container                                                                 | bounded by size, not by age          | -                                                          |
| Backups                                  | age ciphertext in `/srv/tachy/backup-export`, on the same disk until someone downloads it (§6)                        | off-host only once downloaded        | -                                                          |
| Host status                              | `/srv/tachy/status/*.json`, written by backups, the watch script and deploys; mounted read-only in the api            | rebuildable                          | -                                                          |
| Deploy log                               | `/srv/tachy/deploy.log`; in the daily file backup (§6)                                                                | off-host only once downloaded        | -                                                          |

### 2.3 How it is deployed

- **The host never builds.** The checkout is `/opt/tachy`. `tachy-deploy`
  takes a commit or a branch, pulls `ghcr.io/diegokoes/tachy:sha-<12 characters>`,
  plans and applies the schema, and rolls the services (§10).
- **GitHub Actions:**
  - `ci.yml`, on pull requests and on pushes to `main` and `dev`: typecheck,
    `web:check`, the server build and `coverage`. On a push it also builds and
    pushes the image, and runs gitleaks.
  - `image-gates.yml`, on pull requests that touch the image: a Trivy scan and
    the container smoke test.
  - `schema-plan.yml`, when `db/schema.sql` or `db/roles.sql` changes.
  - `load-scripts.yml`, when `load/` changes: bundles the k6 scripts.
  - `image-cleanup.yml`: keeps the 30 newest images.
- **Only Caddy is published,** on 80 and 443. The overlay removes the api's
  port. Postgres listens on `127.0.0.1:5433`.
- **The repository can't show what the laptop runs.** The host playbook has
  not been run there yet. Everything in §13's exit criteria that needs the
  laptop is still open.
- **The dev stack** doesn't run on the laptop. Where it goes is open (§15.1).

### 2.4 What fails first

HTTP throughput is not on this list. Thirty people generate a few requests a
second.

Most likely first. Each was read in the code and not run, unless it says
otherwise. §15.2 lists what is known to be unfinished.

1. **Model calls outside turns take no slot.** Each one-shot call (§2.1)
   starts a Claude Code process, and adds about 100 MiB to its container
   (§3.1). `worker-light` runs at most 4 flows at once: 4 calls at once peaked
   at 424 to 448 MiB of its 512 MB, and 6 were OOM-killed. So
   `TACHY_WORKER_LIGHT_CONCURRENCY` and `TACHY_WORKER_LIGHT_MEM_LIMIT` move
   together, at about 100 MiB a run.
2. **Connections, once the cap rises.** At 40 slots the pools need 110 of
   Postgres's 100 connections (§4.6).
3. **State that dies with the api process:** active turns, pending approvals,
   the maintenance switch and the throttles (§2.2).

## 3. Capacity model (profile A)

The laptop has 16 GB (15.3 GiB usable) and 8 threads. Nothing else runs on it:
no dev stack and no metrics stack. Chat turns are bounded by memory, not CPU,
since a turn spends most of its time waiting on the model provider.

### 3.1 What a turn costs, measured

Measured 2026-09-17 on the workstation. Claude Code ran against a mock
Anthropic API (`ANTHROPIC_BASE_URL`), and each turn made one
`search_knowledge` call through the real MCP server against a real database.
The figures are the peak RSS of the whole process tree, sampled every 250 ms.

| Process in one turn                     | Before (tsx, own model) | Model moved out | Model moved out, compiled |
| --------------------------------------- | ----------------------: | --------------: | ------------------------: |
| Claude Code CLI (agent SDK 0.3.205)     |                  262 MB |          262 MB |                    262 MB |
| MCP child before its first search       |                  255 MB |          255 MB |                    125 MB |
| MCP child after its first search        |             **1116 MB** |          255 MB |                    125 MB |
| **Turn total**                          |            **~1380 MB** |     **~520 MB** |               **~390 MB** |
| MCP child start (spawn to `initialize`) |                  430 ms |          430 ms |                    181 ms |

- Four turns at once measured 5501 MB, which is 4 × 1375 MB. The cost is
  linear, and there is nothing shared to amortise.
- Importing `@tachy/core` under tsx costs 236 MB. The same code bundled by
  esbuild costs 125 MB for the whole child.
- The embedding model accounts for about 880 MB of each child once it has
  searched (weights plus ONNX runtime arenas), and every turn searches.
- The Claude Code figure comes from a short conversation. It grows with context
  and tool results, so the budget below assumes 400 MB.
- **Production runs the third column.** The compiled child measured 107 MB
  once it shipped.

**What the container is charged.** The table above sums the RSS of each
process. A `mem_limit` is the cgroup's figure, and the cgroup holds the pages
that processes share once. Measured 2026-10-04 on the workstation with
`load/turns.mjs` and `load/oneshots.mjs`: the production image, agent SDK
0.3.286, Node 26.10, the mock model with two tool rounds, an empty database.

| At once | A turn adds | A one-shot call adds |
| ------: | ----------: | -------------------: |
|       1 |     171 MiB |               95 MiB |
|       2 |           - |               93 MiB |
|       4 |     149 MiB |              106 MiB |
|       8 |     146 MiB |                    - |
|      15 |     142 MiB |                    - |

- All 15 turns finished and none queued. Postgres connections peaked at 31.
- In a run of 15 that also sampled processes, the Claude Code processes summed
  to 3267 MiB of RSS (218 each, the largest 241) and the MCP children to
  1390 MiB (93 each), while the container grew by 2166 MiB: 144 a turn.
- A one-shot call's process reports 202 to 220 MiB of RSS and adds about 100
  to its container. A 400 KB prompt made that 112.
- So the 0.55 GB budgeted for a turn (§3.2) is close to four times what a
  short turn costs its container. These are short conversations with small
  tool results, and a turn grows with both.

**The same on the laptop,** measured 2026-10-05 with `load/turns.mjs` in the
load window (§11.1), beside the idle production stack, the cap raised to 40 in
the scratch database:

| At once | A turn adds | First event, p95 | Whole turn, p95 | Postgres connections |
| ------: | ----------: | ---------------: | --------------: | -------------------: |
|       1 |     169 MiB |            1.2 s |           3.5 s |                   17 |
|       5 |     166 MiB |            1.6 s |           4.0 s |                   21 |
|      10 |     147 MiB |            2.4 s |           4.9 s |                   26 |
|      15 |     147 MiB |            3.4 s |           5.8 s |                   31 |
|      25 |     143 MiB |            5.5 s |           8.2 s |                   41 |
|      40 |     138 MiB |            9.8 s |          12.2 s |                   51 |

- Every turn finished at every level. Memory is not what limits the laptop:
  40 turns added 5.5 GiB. Its 4 cores are: 40 turns starting at once wait 10 s
  for their first event.
- A one-shot call added 110 MiB at 1, 2 and 4 at once.
- With the default cap of 15, turns 16 to 25 queued and finished, and past the
  queue of 10 the rest were refused, as designed.

**The model itself** is gte-modernbert-base (§5.4). Measured 2026-10-05 on the
workstation in the production image, fp32, on tachý's own code chunks at their
longest, 2400 characters. The embedder ran under the overlay's limits, 6 CPUs
and 2560 MB, which on that host is 6 threads (§3.3).

| The embedder service                                    | Container at peak | Full chunks a second |
| ------------------------------------------------------- | ----------------: | -------------------: |
| loaded and idle                                         |          1283 MiB |                    - |
| embedding 192 full chunks, a search every few seconds   |          1551 MiB |                  2.3 |
| the same on 4 threads, the laptop's count               |          1552 MiB |                  1.8 |
| the heaviest input the queue admits, two rounds (below) |          1757 MiB |                    - |

- One query alone takes 16 ms. The CPU quota throttled nothing.
- **An input is read for 1024 tokens** (`maxTokens` in
  `core/src/search/model.ts`). Attention costs memory by the square of an
  input's tokens, and the model's own files set no limit: 8000 characters are
  1551 tokens of prose, 5945 of base64 and 13442 of Chinese. Uncapped, forty
  code passages of 8000 characters had the embedder OOM-killed at 2560 MB.
  Of this repository's 3089 code chunks one is longer than 1024 tokens.
- **A batch is at most eight texts and 2500 bytes** (`batchBytes`), queries
  and passages alike. Bytes, because a token is at least a byte and can be
  less than a character. A full code chunk goes alone:

  | One batch of full chunks | Holds the model for | Chunks a second | Container at peak |
  | -----------------------: | ------------------: | --------------: | ----------------: |
  |                        8 |               4.6 s |             1.8 |          2288 MiB |
  |                        4 |               2.1 s |             1.9 |          1640 MiB |
  |                        2 |              0.95 s |             2.1 |          1268 MiB |
  |                        1 |              0.43 s |             2.4 |          1100 MiB |

  That table is a bare process on 6 threads; the service holds about 390 MiB
  more. Shorter texts gain too: 1000 characters embed at 6.2 a second two at
  a time against 5.4 in fives, and 600 at 9.8 in fours against 8.7 in eights.

- **The heaviest input** was 40 code passages of 8000 characters, 24 of
  Chinese and 24 of base64 at 8000 characters and again cut to fill a batch
  exactly, and 32 queries of 8000 characters at once. The second round added
  19 MiB to the first, and nothing was killed.
- bge-base-en-v1.5, the model until then, embedded the same chunks at about
  twice the rate (§5.15).
- **On the laptop,** measured 2026-10-05 in the running embedder: 1.08 full
  chunks a second on the runtime's own 4 threads, 3.2 texts of 1000 characters
  and 8.6 of 350, one query in 26 ms, 1533 MiB at peak, nothing throttled, and
  89 °C while it ran.

**Why batches are small,** measured 2026-09-17 with bge-base (on the
workstation, in one process):

| Work                             | Time    | Longest event-loop block | RSS after (from 770 MB warm) |
| -------------------------------- | ------- | -----------------------: | ---------------------------: |
| 1 query                          | 11 ms   |                     0 ms |                            - |
| 20 queries, concurrently         | 212 ms  |                     0 ms |                            - |
| 64 long passages, batches of 32  | 7.4 s   |                **3.7 s** |                  **1653 MB** |
| 64 long passages, batches of 16  | 7.6 s   |                    1.9 s |                      1173 MB |
| 64 long passages, batches of 8   | 7.3 s   |                    0.9 s |                       960 MB |
| 1 query while a batch of 32 runs | 3704 ms |                        - |                            - |

- Queries are cheap. Passages are not, and the cost is in how they're batched.
- Passages went 32 at a time when this was measured. The queue now takes 8 at
  most (`search/embed-queue.ts`). Batches of 8 are just as fast, hold the
  event loop for a quarter as long, and use 700 MB less, because the ONNX
  arena grows to fit the largest batch and never shrinks.

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
  (measured, not inferred from the library). It freezes the process that runs
  it, which is why the model has a process of its own (§5.4).

**Conclusion.** Before Phase 1 the laptop could hold about 5 turns before it
ran out of memory, and nothing stopped a sixth. Taking the model out of the MCP
child is what made 15 possible (§5.4).

### 3.2 Memory budget

| Memory (GB)                                                     |  Tier A |
| --------------------------------------------------------------- | ------: |
| usable                                                          |    15.3 |
| OS, Docker, journald, page-cache floor                          |     1.5 |
| postgres (`shared_buffers` 1 GB; the database was 148 MB)       |     2.0 |
| caddy, the api without its turns, worker-light                  |     0.9 |
| embedder: one model                                             |     1.8 |
| backup and weekly restore test (a scratch Postgres, night only) |     0.6 |
| headroom (the kernel, bursts, a deploy overlapping a drain)     |     1.1 |
| **left for turns**                                              | **7.4** |

§4.6 carries the same table for bigger hosts.

| Per turn                                                      |     GB |
| ------------------------------------------------------------- | -----: |
| budgeted: Claude Code 0.40, the MCP child 0.15, summed as RSS |   0.55 |
| measured: what a short turn adds to the container (§3.1)      |   0.17 |
| **Global cap**                                                | **15** |

At the budgeted figure the 7.4 GB hold 13 turns, and at the measured one 43.
The cap is still 15, set before the container was measured. The laptop's load
window held 40 short turns (§3.1), so raising it is a choice about latency and
longer conversations, made in Admin › system.

A heavy job run isn't in the first table: it holds 3 chat slots while it runs
(§5.3.4), so it comes out of the turn budget.

**The limits follow this budget.** `deploy/compose.prod.yml` sets these
ceilings, and each is a variable in `.env` (§4.3):

| Service      | `mem_limit` |
| ------------ | ----------: |
| api          |          7g |
| postgres     |          2g |
| embedder     |       2560m |
| worker-heavy |       1536m |
| worker-light |        512m |
| caddy        |        256m |
| **sum**      |  **13.75g** |

- That is what the laptop has left after 1.5 GB for the OS. The restore test's
  scratch Postgres has a 1 GB limit of its own and runs at night, in the
  headroom.
- The api's 7g holds its own 0.3 GB and 15 turns at 0.44 GB each, which is
  between the two figures above.
- The embedder's 2560m holds its 1757 MiB peak on the heaviest input its
  queue admits, measured in the container (§3.1), with 800 MiB to spare.

**Admission.**

- The global cap starts at **15** Claude turns, with **1 per user** (§5.5).
- `load/turns.mjs` then runs on the laptop itself, in a load window (§11.1),
  with realistic tool results. If the p95 per-turn peak stays under 0.35 GB,
  the cap goes to 18.
- `tachy-watch` warns when the api container passes 85% of its limit (§8.2).
  An operator then lowers the cap; nothing lowers it automatically.
- The cap counts slots, not turns, and it lives in one setting, so it can be
  changed without a deploy.

**Beyond 15–18 turns: more RAM, not a shared MCP server.**

- The laptop has one DDR4 SO-DIMM slot, holding a single 16 GB module
  (`dmidecode`: Samsung M471A2K43EB1, DDR4-3200), and no soldered memory.
  Lenovo lists "Up to 32GB DDR4-3200" and "One DDR4 SO-DIMM slot"
  ([PSREF](https://psref.lenovo.com/syspool/Sys/PDF/ThinkPad/ThinkPad_E14_Gen_2_Intel/ThinkPad_E14_Gen_2_Intel_Spec.pdf)).
- Replacing it with one 32 GB DDR4-3200 SO-DIMM leaves about 22 GB for turns,
  which is **40 slots** at 0.55 GB (§4.6). It's a module swap, not a project.
- A shared MCP server would save only the compiled child, 0.15 GB per turn,
  which is about 6 more turns on 16 GB. It was reviewed and rejected (§5.12).

**Expected demand:** 30 users × ~10 turns a day gives about 60 turns in the
peak hour. At ~2 minutes per turn that averages 2 concurrent, with bursts of
5–6. A cap of 15 leaves room for a whole team starting chats at once after a
meeting. Confirm the real peak once `turns` has start and end timestamps.
`analysis_runs` records only the finished result.

**Swap.** 976 MB of swap is a cushion, not capacity. The api container's
`mem_limit` is the backstop: if turns overrun their budget, the kernel
OOM-kills inside that container, and Postgres survives.

### 3.3 CPU

Measured: under sustained all-core load the i7-1165G7 holds 89 °C and keeps
about 90% of its peak frequency (§12).

- `postgres`, `api` and `embedder` each get 2048 `cpu_shares`.
- The embedder is capped at 6 CPUs. It runs one batch at a time, queries
  first, so a search never waits behind more than one passage batch: 0.43 s
  for a full code chunk on the workstation and up to 0.8 s for an input of
  1024 tokens, and about 0.9 s for a full code chunk on the laptop. A burst of searches from 15 turns costs about 16 ms each.
- **The model's threads follow the CPU limit** (`core/src/search/threads.ts`).
  ONNX Runtime starts one thread per physical core of the host and pins each
  to its core, whatever the container's quota or mask
  ([threading](https://onnxruntime.ai/docs/performance/tune-performance/threading.html):
  "INTRA Threads Total = Number of physical CPU Cores"). On the 14-core
  workstation under the 6-CPU limit that made 8 full chunks take 68 s, against
  3.9 s with no limit.
  - When the limit is below the host's cores, the model gets as many threads
    as the limit: the quota in whole CPUs, or the cores a CPU mask leaves,
    whichever is smaller.
  - The laptop has 4 cores under a 6-CPU limit, so the runtime keeps its
    default of 4. Six threads on 4 cores measured slower than four.
  - `TACHY_EMBED_THREADS` sets the count outright. The embedder logs the
    count it loaded with (`embedding_model_ready`).
  - Waiting threads do not spin (`session.intra_op.allow_spinning` "0").
    Spinning counts against a quota: 6 threads under 6 CPUs embedded at 1.25
    chunks a second with it and 2.19 without. With no limit it bought 3% for a
    quarter more CPU.
- `worker-heavy` is capped at 4 CPUs. Its embedding happens in the embedder,
  at low priority, so the cap covers git and SQL work.
- Nothing sets `nice`.

### 3.4 Disk

Alert at 80% on every mount separately.

- `/var` (12 G, 40% used when measured) held containerd's image layers. The
  playbook moves containerd's root to `/srv/containerd` and Docker's to
  `/srv/docker` (`deploy/host/tasks/docker.yml`). Keep the last three releases
  and prune the rest.
- `/srv` (432 G, 2% used) holds Postgres, repo clones, dump staging and the
  backup export. At a 52 MB dump, backups are negligible.

## 4. Topology

### 4.1 Profile A: laptop

```text
Production (docker-compose.yml + deploy/compose.prod.yml)

LAN/VPN --443--> caddy --> api --+--> postgres <-- worker-light, worker-heavy
pushers --443--> /ingest         |                 (jobs; they embed through
                                 |                  the embedder, low priority)
                                 `--> turn trees (cap 15) --> MCP child
                                        MCP child --HTTP--> embedder
                                        MCP child --HTTP--> api /internal/log
                                        MCP child ---------> postgres
host timers: backup -> age -> /srv/tachy/backup-export <-sftp- team laptops
             tachy-watch (every minute) -> Teams webhook
             heartbeat -> external check

Without the overlay (development, CI)

browser --8787--> api --+--> postgres
                        +--> embed worker thread (one model, queries first)
                        +--> jobs, one slot per class
                        `--> turn trees --> MCP child --HTTP--> api embed queue
```

A pusher is a script outside tachý that holds one bucket's ingest token (§7).

### 4.2 Services and replicas

| Service    | A · without the overlay | A · production    | B · server         | C · HA                          |
| ---------- | ----------------------- | ----------------- | ------------------ | ------------------------------- |
| caddy      | -                       | 1                 | 1                  | 1 per app host, behind a VIP    |
| api        | 1 (runs turns)          | 1 (runs turns)    | 2, stateless       | 2+ across hosts                 |
| agent      | -                       | -                 | 1–2                | 1+ per app host, sticky by user |
| embedder   | - (a thread in the api) | 1                 | 1–2                | 1 per app host                  |
| worker     | - (the api works jobs)  | 2: light, heavy   | 2+                 | 2+, cron under a leader lock    |
| postgres   | 1                       | 1                 | 1, on its own host | primary and standby             |
| monitoring | -                       | host watch script | same, per host     | same, per host                  |

### 4.3 Limits on the laptop

From `deploy/compose.prod.yml`. Each size is a variable in `.env`, and the
value shown is its default, the laptop's. `0` lifts a memory or CPU limit
(checked on Docker Compose 5.6: the container's `memory.max` and `cpu.max` read
`max`).

| Service      | mem_limit                              | CPU                                                                                  | pids_limit                        | Other                                                                               |
| ------------ | -------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------- | ----------------------------------------------------------------------------------- |
| caddy        | 256m (`TACHY_CADDY_MEM_LIMIT`)         | 1024 shares                                                                          | 256                               | the only published ports, 80 and 443                                                |
| api          | 7g (`TACHY_API_MEM_LIMIT`)             | 2048 shares, no cap                                                                  | 2048 (`TACHY_API_PIDS_LIMIT`)     | `init: true`, `stop_grace_period` 210 s (the drain plus 30 s)                       |
| embedder     | 2560m (`TACHY_EMBEDDER_MEM_LIMIT`)     | `cpus: 6` (`TACHY_EMBEDDER_CPUS`), 2048 shares; the model's threads follow it (§3.3) | 256                               | healthcheck on its `/readyz`                                                        |
| worker-light | 512m (`TACHY_WORKER_LIGHT_MEM_LIMIT`)  | `cpus: 1` (`TACHY_WORKER_LIGHT_CPUS`), 512 shares                                    | 256                               | 4 runs at once (`TACHY_WORKER_LIGHT_CONCURRENCY`), `stop_grace_period` 90 s         |
| worker-heavy | 1536m (`TACHY_WORKER_HEAVY_MEM_LIMIT`) | `cpus: 4` (`TACHY_WORKER_HEAVY_CPUS`), 256 shares                                    | 256                               | 1 run at a time (`TACHY_WORKER_HEAVY_CONCURRENCY`); runs k6 for `load.test` (§11.3) |
| postgres     | 2g (`TACHY_POSTGRES_MEM_LIMIT`)        | 2048 shares                                                                          | 512 (`TACHY_POSTGRES_PIDS_LIMIT`) | `shm_size: 1gb`; its conf (§5.9) is replaced with `TACHY_POSTGRES_CONF`             |

- The memory limits sum to 13.75 GiB (§3.2).
- `pids_limit` is 2048 on the api because 15 turn trees each hold dozens of
  threads.
- The pools are variables too: `TACHY_API_DB_POOL_MAX` (15) and
  `TACHY_WORKER_DB_POOL_MAX` (5).
- The chat slot cap is a setting, changed in the admin page (§5.5).
- **On another host,** set these from its own budget (§4.6) and point
  `TACHY_POSTGRES_CONF` at a `postgresql.conf` sized for it. Nothing else in
  the overlay names the laptop. `.env.example` lists the variables.

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

### 4.6 Search and embedding by hardware tier

The profiles say how many hosts there are. The tiers below say what the
application host holds, and what search runs on it. Profile C takes the tier of
each of its application hosts.

| Tier  | Application host                                                                        | Profile |
| ----- | --------------------------------------------------------------------------------------- | ------- |
| A     | the laptop as it is: i7-1165G7, 4 cores and 8 threads, 16 GB, no GPU                    | A       |
| A+    | the same laptop with one 32 GB DDR4-3200 SO-DIMM, its documented maximum (§3.2)         | A       |
| B-cpu | a server with about 64 GB and 16 or more cores, no GPU; Postgres on its own host (§4.4) | B, C    |
| B-gpu | B-cpu plus one NVIDIA GPU of the Turing generation or newer, with 16 GB of VRAM or more | B, C    |

**Demand decides what the memory is for.** §3.2 expects bursts of 5–6
concurrent turns from 30 users, and tier A's cap of 15 already covers them.
Up to A+, more memory buys turns. Past A+ it buys search quality and latency,
until the number of users grows.

**Memory budget,** by the §3.2 method. Phase 2 services are counted: the api
without the model measured 84 MiB and the embedder 925 MiB. A heavy
job run holds 3 chat slots (§5.3.4), so it is drawn from the turn budget
instead of being listed here.

| GB                                           |       A |     A+ |    B-cpu |    B-gpu |
| -------------------------------------------- | ------: | -----: | -------: | -------: |
| usable                                       |    15.3 |     31 |       62 |       62 |
| OS, Docker, journald, page-cache floor       |     1.5 |    1.5 |      2.0 |      2.0 |
| postgres                                     |     2.0 |    2.0 | own host | own host |
| caddy, api (two replicas on B), worker-light |     0.9 |    0.9 |      1.2 |      1.2 |
| embedder (models below)                      |     1.8 |    2.0 |      4.0 |      4.0 |
| backup and restore test                      |     0.6 |    0.6 | own host | own host |
| headroom                                     |     1.1 |    2.0 |      4.0 |      4.0 |
| **left for turns**                           | **7.4** | **22** |  **~50** |  **~50** |
| **slots at 0.55 GB**                         |  **13** | **40** |  **~90** |  **~90** |

The A+ and B columns were costed with bge-base: each embedder instance is
0.8 GB larger with gte-modernbert-base, and the code model in them is no longer
planned. Tier A's cap stays at 15 (§3.2).

The B-gpu embedder row is host memory for the process that drives the GPU,
**to verify** on the card chosen.

**What runs on each tier:**

| Concern                    | A                                       | A+                                     | B-cpu                                                           | B-gpu                                                      |
| -------------------------- | --------------------------------------- | -------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| chat slot cap              | 15                                      | 40                                     | set from demand; memory allows ~90                              | same as B-cpu                                              |
| Postgres `max_connections` | 100                                     | 150                                    | 250, or PgBouncer in front of MCP children only                 | same as B-cpu                                              |
| Postgres memory            | §5.9                                    | §5.9                                   | `shared_buffers` 25% of the database host's RAM                 | same as B-cpu                                              |
| embedder instances         | one, queries ahead of passages          | two: one for queries, one for passages | two instances and the reranker                                  | one GPU process for all models                             |
| runtime                    | transformers.js on CPU, fp32            | same                                   | same                                                            | TEI's CUDA image, or transformers.js with `device: "cuda"` |
| passage batch              | 8 texts or 2500 bytes                   | same                                   | same                                                            | measured on the card                                       |
| text and code model        | gte-modernbert-base                     | same                                   | same                                                            | same                                                       |
| reranker (§5.14)           | none                                    | none                                   | ms-marco-MiniLM-L-6-v2 over the top 20, text cut to ~256 tokens | bge-reranker-base over the top 30                          |
| candidates per leg         | 50 (`search/rank.ts`)                   | same                                   | same                                                            | same                                                       |
| HNSW                       | m 16, ef_construction 64, ef_search 100 | same                                   | same                                                            | same                                                       |
| job pools (§5.3.4)         | light ×4, heavy ×1                      | same                                   | heavy ×2, or an indexing worker split off                       | same as B-cpu; embedding runs on the GPU                   |

**The arithmetic behind the connection row.** The pools are the api's 15, 5
each for the two workers and the cli, and 2 per MCP child
(`api/src/turn-config.ts`), against `max_connections = 100`
(`deploy/postgres/postgresql.conf`). At 15 slots that is 60. At 40 it is 110,
over the limit before anyone opens `psql`. At 90 it is about 215 with two api
replicas.

**PgBouncer only in front of the MCP children.** Transaction pooling forbids
session features: "clients must not use any session-based features, since
each transaction ends up in a different connection"
([PgBouncer](https://www.pgbouncer.org/config.html)).

- **Safe behind it:** search's `set local` (`search/rank.ts`) and the
  `pg_*_xact_lock` calls are scoped to the transaction.
- **Prepared statements work** through `max_prepared_statements`, which tracks
  them "in transaction and statement pooling mode"
  ([PgBouncer](https://www.pgbouncer.org/config.html)). The
  [postgres.js README](https://github.com/porsager/postgres) notes support
  since PgBouncer 1.21.
- **The job worker can't go through it.** It holds a `LISTEN`
  (`core/src/jobs/worker.ts`). So the api and workers connect directly.

On A+ raising `max_connections` is enough.

**Impact of each change:**

- **A query instance of its own (A+).** A search never waits behind a passage
  batch. Today it can wait about 0.7 s behind a code chunk and up to about
  1.2 s behind the longest passage (§3.3).
  - Costs about 0.9 GB.
  - The two instances still share 8 threads, so each needs an explicit
    thread count: about 2 for queries, the rest for passages.
    `TACHY_EMBED_THREADS` sets it per instance (§3.3).
- **Slot cap 40 and `max_connections` 150 (A+).** The §15.1 module swap,
  costed with Phase 2's services. The two changes ship together.
- **A reranker (B-cpu, B-gpu).** Measured in §5.14. On CPU only the small
  model over short text fits a search's latency; bge-reranker-base needs the
  GPU.
- **A GPU runtime (B-gpu).** Bulk embedding (backfill, repo reindex) and
  reranking leave the CPU. There are two routes:
  - **[TEI](https://huggingface.co/docs/text-embeddings-inference/supported_models).**
    It runs on "CPU, Turing (T4, RTX 2000 series, ...), Ampere ..., Ada
    Lovelace ..., Hopper ..., and Blackwell" and "does **not** support CUDA
    compute capabilities < 7.5". It lists both jina v2 models and
    bge-reranker-base, and serves `/embed` and `/rerank` with "token-based
    dynamic batching". It has no notion of priority, so `EmbedQueue` stays in
    front of it, and `TACHY_EMBED_URL` points at an adapter.
  - **transformers.js on CUDA.** transformers.js 4.3.0 offers `cuda` on Linux
    x64 for CUDA 12
    (`node_modules/@huggingface/transformers/src/backends/onnx.js`). But
    onnxruntime-node doesn't bundle the CUDA provider. Its install script says
    they are "too large to be allowed in the npm registry", and downloads them
    with `ONNXRUNTIME_NODE_INSTALL=cuda12`
    (`node_modules/onnxruntime-node/script/install.js`). The image would need
    a CUDA 12 base and that variable at `npm ci`. The workstation's install
    holds only `libonnxruntime.so.1`.
  - Latency and throughput on a card: **to verify**.
    **The same on every tier:**

- The agent's output limits:
  - search returns 8 by default (`clampLimit(opts.limit, 8)`);
  - code snippets are 1200 characters;
  - `read_code_file` stops at 400 lines or 64 KB.

  They're sized by context cost, which a bigger host doesn't lower.

- One embedder service per host, with queries ahead of passages (§5.4).
- Rank fusion with candidates from each leg. A reranker reorders its output
  and doesn't replace it.
- HNSW parameters. pgvector's defaults are m 16, ef_construction 64 and
  ef_search 40 ([README](https://github.com/pgvector/pgvector)); tachý searches
  at 100. At 148 MB of data, recall is close to exact. Revisit only when a
  golden query misses in the vector leg and a larger `ef_search` finds it.
- A passage batch capped by characters on CPU (§3.1).
- One model for tickets and code, and the lexical leg of code search (§5.15).

**The golden sets are small.** Tickets have 14 queries
(`test/fixtures/search-corpus.ts`) and code has 45 questions about tachý's own
source (`test/fixtures/code-golden.ts`). Both were written by the people who
built the search, which is the weakest kind. Load runs on a synthetic seed
don't help: there "the vector leg of hybrid search contributes **nothing**"
(`load/README.md`).

## 5. Decisions

### 5.1 One API process until it is stateless

**Decision.** Profile A runs exactly one `api`.

**Why.** The API isn't the bottleneck. `load/browse.js` runs 20 rps against
p95 budgets of 50 to 800 ms by endpoint, and the measured baseline is
`knowledge_search` p95 ≈ 260 ms at 10 rps (`load/README.md`, on a
workstation). The real limits are embedding
CPU, turn RAM and provider rate limits, and adding replicas fixes none of them.
A second replica today breaks the rows marked **breaks** in §2.2.

**Revisit.** In profile B, once turns live in the agent service (§5.5).
Uploads are already in Postgres (§5.6). From then on, two replicas rolled with
`docker-rollout` make API deploys invisible to users.

### 5.2 No Redis

**Decision.** Postgres carries every coordination need:

- job queues with `FOR UPDATE SKIP LOCKED`, woken by `LISTEN/NOTIFY` with an
  id as the payload. Built (§5.3);
- turn events and approvals as tables. Profile B (§5.5);
- throttles, once there is more than one api. The login throttle is
  in-process today (§2.2).

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

**Decision.** A general job layer that features plug into: syncs, reindexes,
sweeps, flows, and anything else that runs on a schedule or in response to
something. It has three parts:

| Part           | Lives in                 | Who changes it                    | Example                                                           |
| -------------- | ------------------------ | --------------------------------- | ----------------------------------------------------------------- |
| **Kind**       | code, next to its domain | a developer, by pull request      | `repo.reindex` in `core/src/code`, `source.sync` in `sources`     |
| **Definition** | `job_definitions` table  | a global admin, in the UI         | "reindex repo `billing`, nightly at 02:00, notify Teams"          |
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
  params: z.object({ repo: z.string().min(1), line: z.string().optional() }),
  queue: "index", // a lane in JOB_QUEUES; its class picks the worker pool
  dedupeKey: (p) => p.repo, // at most one queued or running run per key
  timeout: "8h",
  run: async (ctx, params) => {
    // ctx.signal (cancel), ctx.progress(0..1, note), ctx.log(),
    // ctx.requestedBy, ctx.credential(name), ctx.enqueue(kind, params)
  },
});
```

Optional fields, with their defaults (`core/src/jobs/registry.ts`):

| Field             | Default       | Meaning                                                   |
| ----------------- | ------------- | --------------------------------------------------------- |
| `queue`           | `maintenance` | the lane, and through it the worker pool                  |
| `overlap`         | `skip`        | `skip` or `queue`, when the previous run is still going   |
| `missed`          | `run-once`    | `run-once` or `skip`, when the host was down at fire time |
| `maxAttempts`     | 1             | retries with exponential backoff                          |
| `defaultSchedule` | none          | a cron string; a definition is created for it once        |
| `connection`      | none          | a source type whose connections the form offers           |

The worker renews a run's lease by itself, so a kind has no heartbeat to call.

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
- **Shared vocabulary.** Trigger types, statuses, resource classes, queues and
  priorities go in `@tachy/contract`, since both sides enforce them. Kind ids
  stay in code and reach the SPA through `/jobs/kinds`.

#### 5.3.2 Tables

- **`job_definitions`:**
  - `kind`, `name`, `params` (jsonb, validated against the kind on every save
    and at worker start), `enabled`;
  - `schedule` (cron, nullable), `timezone` (IANA). A definition saved without
    one takes the organisation's: the `org_timezone` setting, then
    `TACHY_TIMEZONE`, then `UTC`. The default definitions take it as well, so
    retention and the nightly reindex run at night there;
  - `queue`, `timeout` and `overlap`, each overriding the kind's default
    (`resource_class` is still written, from the queue, for the previous
    release to read on rollback);
  - `notify` (on failure, on success, never);
  - `created_by`, `updated_by`, and timestamps.
- **`job_runs`**:
  - `definition_id` (null for one-off runs), `kind`, `params` snapshot;
  - `queue`, `resource_class` (the queue's), `priority`, `dedupe_key`, and
    `parent_id` for a run another run queued;
  - `trigger` (`schedule` / `manual` / `event`), `scheduled_for`,
    `requested_by`;
  - `status` (`queued` / `running` / `succeeded` / `failed` / `cancelled` /
    `timed_out`), `attempts`, `run_after` (backoff);
  - `locked_by`, `locked_until` (a lease the worker extends by heartbeat);
  - `progress`, `progress_note`, `output` (small jsonb summary), `error`,
    `log_tail` (the last ~200 lines, passed through redaction);
  - timestamps.
  - Unique `(definition_id, scheduled_for)`, so a double firing inserts one run,
    and unique `dedupe_key` among queued and running runs, so two clicks on
    "index" queue one reindex and the second gets the first's id back.
- **`job_definition_changes`:** who changed what, old and new values. A
  schedule edit can silently stop a sync, so every change is recorded.
- **`job_workers`:** each worker process as it reports itself every 15 s: host,
  pid, classes, the queues it claims from, slots. One unseen for a minute shows
  as gone; the reaper forgets it after 15 minutes. The workers page lists them
  with the runs each holds (`job_runs.locked_by`), and a queue with runs waiting
  and no live worker is raised as an issue.

#### 5.3.3 Triggers

| Trigger      | How a run is created                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Schedule** | Every 30 s a worker inserts the runs that are due, under a transaction advisory lock so only one does. After downtime it applies the definition's `missed` policy once, not once per missed slot. |
| **Manual**   | "Run now" in the UI inserts a run with `trigger = manual` and the admin as `requested_by`.                                                                                                        |
| **Event**    | Code that changes data inserts the run **in the same transaction**, then `NOTIFY job_runs`. A run can't be lost, and nothing polls. Example: a bucket ingest queues `bucket.embed`.               |

Workers `LISTEN` for new runs and also poll every 10 s, so a missed
notification costs seconds, not a run.

#### 5.3.4 Resource classes and queues

Memory and CPU limits are cgroup settings, fixed when a container starts.
Setting them per run from the UI would need the Docker socket or host systemd,
which hands the web app the host (§7). So:

- **Classes are worker pools declared in Compose.** Each pool claims only runs
  of its own class:

  | Class   | Service        | mem_limit | cpus | Runs at once | Counts against the chat cap as |
  | ------- | -------------- | --------- | ---- | -----------: | -----------------------------: |
  | `light` | `worker-light` | 512m      | 1    |            4 |                        0 slots |
  | `heavy` | `worker-heavy` | 2g        | 4    |            1 |                        3 slots |

- **Queues are lanes inside a class,** declared in `JOB_QUEUES`
  (`contract/src/jobs.ts`):

  | Queue         | Class | Runs at once, across all workers |
  | ------------- | ----- | -------------------------------: |
  | `index`       | heavy |                                1 |
  | `embed`       | heavy |                                1 |
  | `testing`     | heavy |                                1 |
  | `sync`        | light |                                2 |
  | `flows`       | light |                                4 |
  | `maintenance` | light |                         no limit |

  A queue is a routing label, not a process, so adding one costs nothing until
  a pool is sized for it. A pool serves every queue of its class unless
  `TACHY_WORKER_QUEUES` names some, which is how a dedicated indexing worker
  would be split off. The cap keeps a reindex fan-out from filling the heavy
  pool while an embedding backfill waits.

- **Priority** orders claims within the queues a worker serves: manual 10, event
  5, schedule 0, and a run another run queued takes its parent's. A reindex
  someone clicked goes ahead of the nightly refresh's backlog.
- **Without worker services** (`TACHY_WORKER` unset), the API process works both
  classes with one slot each, so a two-hour reindex cannot hold up a sync.
- **In the UI,** a definition picks a queue, a timeout and an overlap rule.
  Embedding priority, batch size and an ONNX thread count per definition were
  planned and are not built.
- **Shared budget.** Heavy runs take chat slots (§3.2) while they run. The UI
  shows the effect before saving: "while this runs, the chat cap is 12". A
  rule that a heavy run waits until fewer than N chats are active is not
  built.
- Pool sizes and limits stay in Compose, visible in the UI but not editable
  there.

#### 5.3.5 Running a run

- **Claiming:** `update … where id = (select … for update skip locked limit 1)`,
  filtered by class and queue, skipping queues at their cap, highest priority
  then oldest first. Claims take turns under a transaction advisory lock, so
  two workers cannot both see room under a cap. A reaper requeues runs whose
  lease expired.
- **Fan-out:** `ctx.enqueue` links the new run to its parent. The runs view
  shows a parent's children done out of total, and opens onto them.
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
- **Logs:** `ctx.log` goes to the container log with the run id, and the last
  200 lines go to `log_tail` after passing through `scrubText`. A kind that
  handles customer text must never print raw values.
- **Alerting:** per-definition `notify` sends to a second Teams workflow whose
  URL is a vault credential (`core/src/jobs/notify.ts`). `tachy-watch` keeps
  its own URL on the host, so host alerts still work while the application is
  down, and it reads job health from the api (§8.2), so a definition with
  `notify` off does not fail silently.
- **Retention:** runs keep 90 days; failed ones 180.

#### 5.3.6 What stays out of the job layer

Backups, restore tests, `tachy-watch` and the heartbeat stay host systemd
timers (§6.1). They have to run when the application is broken, so the admin
page shows them (§5.13) and never schedules them.

#### 5.3.7 The kinds

| Kind                  | Queue       | Schedule       | Does                                                     |
| --------------------- | ----------- | -------------- | -------------------------------------------------------- |
| `repo.reindex`        | index       | -              | fetches one repo's tracked lines and embeds what changed |
| `repos.refresh`       | maintenance | 02:40 daily    | queues a `repo.reindex` for each linked repo             |
| `source.sync`         | sync        | per definition | pulls one source connection                              |
| `embeddings.backfill` | embed       | -              | embeds rows with no vector, or all of them (§5.15)       |
| `bucket.embed`        | embed       | -              | embeds the chunks a bucket ingest wrote                  |
| `retention.sweep`     | maintenance | 03:30 daily    | applies the retention rules (§7)                         |
| `wiki.gaps`           | maintenance | hourly         | finds wiki gaps                                          |
| `flow.run`            | flows       | per flow       | one pass of a flow over one item                         |
| `load.test`           | testing     | -              | runs a k6 script against a named target (§11.3)          |

**Why.** It extends what was already there: the index status on `repo_lines`,
`sweepInterruptedIndexes` (`core/src/code/repos.ts`) and
`source_connections.last_synced_at`. It takes indexing and sweeps out of the
request process. A new integration is a kind plus a definition, with no new
infrastructure.

**Alternatives.**

- pg-boss, for the queue alone, if the in-house version grows past a few
  hundred lines. It keeps its own schema outside `schema.sql`, which is the
  cost, and it has no notion of definitions configured in a UI.
- n8n, Windmill or Temporal. Each is a second stateful service with its own
  users, and they run user-written code, which is what this decision rules
  out.

**Flows run unattended, with their owner's credentials.** A flow is a graph
that admins build from steps defined in code (`core/src/flows`), so "no scripts
from the UI" still holds. Each pass is a `flow.run` in `worker-light`. What
that adds to operations:

- **Flows write to source systems.** Steps can post a note, create an Azure
  DevOps item, change tags and start jobs. They act with the flow owner's
  tokens, so the worker decrypts vault credentials and holds
  `TACHY_SECRET_KEY`.
- **Flows call the model.** The `agent.ask` and `agent.summarize_item` steps
  each run one prompt with the owner's model credential and no tools
  (`agent/src/flow-actions.ts`). They take no chat slot (§2.4).
- **A flow's model calls are limited.** Each flow has `model_calls_per_day`,
  100 by default and set in the flow editor. Once it has made that many in 24
  hours the step refuses and the run fails saying so. A call is counted when it
  succeeds, and up to 4 runs of a flow can be in flight, so it can overshoot
  by 3. What each flow spent is in the usage census
  (`core/src/analytics/usage.ts`), and the users overview shows the total.
- **`flow_runs` are swept** like job runs (§7).

### 5.4 One embedding model per host

**Decision.** Exactly one process on the host holds the embedding model, and it
never runs on an event loop that serves requests.

- **In production** the model lives in the `embedder` service
  (`api/src/embedder.ts`). It serves `POST /internal/embed` on the Compose
  network only, and Caddy answers 404 for `/internal`.
- **The model is gte-modernbert-base,** for tickets and code alike (§5.15).
- **One queue** (`core/src/search/embed-queue.ts`): queries always go first,
  and passages go in small batches (§3.1), one batch per caller in turn. Background
  jobs send theirs at low priority (`TACHY_EMBED_PRIORITY`).
- **`TACHY_EMBED_URL` is the switch** (`core/src/search/embeddings.ts`).
  - With it set, embedding goes over HTTP. The api, both workers and every MCP
    child get it, with the secret they must send, so none of them loads the
    model.
  - With it unset, the process embeds by itself: the api in a worker thread
    (`core/src/search/embed-host.ts`), and the CLI, the tests and
    `scripts/eval-embeddings.ts` in-process.
- **The secret is shared and static in production:** `TACHY_INTERNAL_SECRET`
  from `.env`, 32 characters or more (`api/src/embedder.ts`). The api
  makes up a per-boot secret only when the variable is unset
  (`api/src/index.ts`).

**What got worse:**

- **One queue for everyone.** A 500-chunk reference document saved by one turn
  takes about a minute of passage embedding. Queries still go first, and the
  passage queue takes turns between callers, one batch each.
- **An internal endpoint.** It accepts text and returns vectors, and it reads
  and writes nothing. Leaking the secret gives only the ability to use CPU,
  which the request-size limit bounds.
- **The embedder is a dependency of every search.** If its model thread dies
  it restarts (`embed-host.ts`). Searches fail with a retryable 503 until it is
  back, and `/readyz` goes red. A model that fails to load three times exits
  the process.
- **The model is always in memory,** about 1.1 GB even when nobody searches.

§4.6 says what changes on bigger hosts, and §5.15 how to change the model.

### 5.5 Agent turns: admission control now, an agent service later

**Built, in the api process:**

- **A global cap of 15 slots,** held in a setting (`core/src/config/settings.ts`).
  A turn is 1 slot. A running heavy job takes 3 slots from the same cap (`api/src/turns.ts`).
- **One active turn per user.** A new message from a user with a turn still
  running returns 409 with that turn's id, and the UI offers to stop it
  (`api/src/routes/agent.ts`).
  - Callers using the API token share one identity (`env.userEmail`), so they
    count as one user. That is correct for a single integration.
- **An abandoned turn is aborted.** A turn whose SSE stream closes with no
  approval pending is aborted after 30 s.
- **A queue, then a refusal.** Beyond the cap, the turn waits and its stream
  carries a `queued` event with its position. Past 10 waiting, the api answers
  429 with `Retry-After`.
- **The MCP child is small:** compiled to JavaScript (`dist/mcp.js`), a 256 MB
  heap cap, and a pool of 2 with a 30 s idle timeout. 15 turns × 2 is 30
  connections.
- **An SSE keepalive** comment every 20 s, because approvals can wait 15
  minutes (`agent/src/turn.ts`) and idle connections get cut.

**Not counted by the cap:** one-shot model calls and the model flow steps
(§2.4).

**Profile B, an `agent` service that owns turns.** Not built:

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

**Decision.** No MinIO or NAS for application data. Exports and chat uploads
both live in Postgres with a TTL.

- **Uploads** are rows in `chat_uploads`. They expire after 24 h
  (`TACHY_UPLOAD_TTL_HOURS`), only their owner's turn can read them
  (`core/src/chat/uploads.ts`), and `retention.sweep` deletes them.
- **Neither table's data is in the dumps** (`deploy/backup/tachy-backup`).

**Revisit.** If uploads regularly approach the 25 MB limit
(`api/src/upload-limit.ts`), or several hundred MB a day, then the database is
the wrong home for them.

### 5.7 Caddy at the edge

**Decision.** Caddy is the only published service, on 443 with 80 redirecting.
The production overlay removes the api's port (`deploy/caddy/Caddyfile`).

**TLS has two modes,** chosen by `TACHY_TLS`:

- `internal`, the default: Caddy's own CA signs the certificate and renews it.
  Clients install its root once (`deploy/runbooks/tls-client-trust.md`).
- a mounted certificate and key, for one issued by IT or the company CA.

A publicly trusted certificate by DNS-01 isn't available: the stock Caddy
image carries no DNS module. It would need a custom Caddy build (§15.1).

**What the Caddyfile does besides TLS:**

- HSTS for a year, `nosniff`, `X-Frame-Options DENY`, a referrer policy, and no
  `Server` header. There is no Content-Security-Policy.
- `/internal` answers 404.
- One body limit of 26 MB for every path: the 25 MB upload cap plus multipart
  overhead. The api enforces the smaller caps itself: 5 MB for library images
  and 16 MB for a bucket batch.
- Its upstream health check is `/readyz`.

**Why TLS is not optional.** Entra requires it: "Redirect URIs must begin with
the scheme `https`, with exceptions for some localhost redirect URIs"
([docs](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)).
The session cookie's `Secure` flag trusts `X-Forwarded-Proto`
(`api/src/auth.ts`). That is safe only because the api is reachable
nowhere except through the proxy.

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

These are the values in `deploy/postgres/postgresql.conf`, which only the
production overlay mounts. Development and CI run on the image's defaults. They
are sized for the laptop: another host mounts its own file with
`TACHY_POSTGRES_CONF`.

`shm_size: 1gb` is set in `docker-compose.yml`, since Docker's default
`/dev/shm` is 64 MB and parallel HNSW builds failed without it. The image is
pinned to a pgvector version as well as a Postgres major
(`pgvector/pgvector:0.8.6-pg16`): a floating `pg16` tag can change the
extension under a running database. The restore test reads the image from
the Compose file, so a bump changes one place.

**Pools,** per process type:

| Process                 | Pool `max` |
| ----------------------- | ---------: |
| api                     |         15 |
| worker-light            |          5 |
| worker-heavy            |          5 |
| MCP child, one per turn |          2 |
| cli                     |          5 |

The api's and the workers' are variables (§4.3).

§4.6 adds these up against `max_connections` for each slot cap.

**Roles,** created in `db/roles.sql`. It is idempotent, and it runs after
`schema.sql` on a fresh volume and again on every deploy, because a new table
needs its grants. Passwords never sit in SQL: `deploy/postgres/role-passwords.sh`
sets them from `.env`, on a fresh volume and on every deploy. `roles.sql` also
sets default privileges, so a table the schema plan adds is granted to
`tachy_app` as it is created.

| Role           | Used by                                                         | Rights                                                                                                                 |
| -------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `tachy_owner`  | schema apply                                                    | meant to own every object. Not created: `tachy-deploy` applies the schema as the bootstrap superuser                   |
| `tachy_app`    | api, workers, MCP children                                      | DML on application tables, `pg_read_all_stats`, and a 60 s `statement_timeout`                                         |
| `tachy_mcp`    | the chat tools' subprocess, when `TACHY_MCP_DB_PASSWORD` is set | DML as `tachy_app`, except: no `credentials`, no `api_tokens`, no `users.password_hash`, insert-only on `audit_events` |
| `tachy_backup` | `pg_dump`                                                       | `pg_read_all_data` (Postgres 14+)                                                                                      |
| `tachy_watch`  | `tachy-watch`                                                   | `pg_monitor`. No password: it logs in only where `pg_hba` trusts, inside the postgres container                        |

**Why the roles.** The MCP child is driven by a model and inherits the api's
`DATABASE_URL` (`api/src/turn-config.ts`). A superuser can run
`COPY … TO PROGRAM`. The tools expose no raw SQL, but least privilege is the
second wall.

**What is still the superuser:**

- the schema apply, since `tachy_owner` does not exist;
- everything without the overlay: the base `docker-compose.yml` hands the api
  and the `cli` the superuser, with the default password `tachy`.

In production the overlay requires `POSTGRES_PASSWORD`, and the `cli` runs as
`tachy_app`. `sync backup` and `sync restore` through the `cli` need the owner,
passed for that run; production backs up and restores with `tachy-backup` and
`pg_restore` in the postgres container instead.

**Not built:** a worker raising `statement_timeout` for a long job. Every
statement a job runs has 60 s.

### 5.10 Schema upgrades: a declarative diff of `schema.sql`

**Decision.** `schema.sql` stays the only source, and no migration files are
ever written. At deploy, a tool diffs the live database against `schema.sql`,
prints the plan, and applies it.

**Decided (2026-09-17): pg-schema-diff.** The spike ran it against this schema
and it met every criterion below. `tachy-deploy` runs the binary from the new
image, and the `schema-plan` CI job runs `scripts/schema-plan.sh`.

- [pg-schema-diff](https://github.com/stripe/pg-schema-diff) (Stripe), v1.0.9.
  Measured on the real schema: it plans, validates on a temporary database and
  applies; a re-plan is empty; a database built fresh from `schema.sql` also
  plans empty, so it round-trips the three extensions, `tachy_join`, the
  generated `tsvector` columns, the triggers, the HNSW indexes with their
  options and `gin_trgm_ops`. It flags a dropped column as `DELETES_DATA` and
  refuses it unless allowed, and downloads nothing. Renames still look like a
  drop plus an add, which is what expand and contract is for.
  **What the spike covered:** the 3 extensions, `tachy_join`, the generated
  `tsvector` and `search_text` columns, the triggers, HNSW indexes with
  `with (m, ef_construction)`, and `gin_trgm_ops`. All round-trip.

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
- Changing the embedding model needs no schema change. Changing the vector
  dimension needs the vectors nulled before the plan runs (§5.15).
- Profile B's two-replica deploys need every schema change to be compatible
  with both the old and the new image. Expand and contract becomes the norm.

When the diff tool can't express a change, dump, recreate and restore is the
fallback (`deploy/runbooks/schema-change.md`).

### 5.11 Build once, deploy by digest

**Image:**

- a multi-stage build: esbuild bundles the server, and the runtime stage runs
  `npm ci --omit=dev`. Nothing runs through `tsx`, which also shortens every
  MCP spawn;
- `CMD ["node", "dist/api.js"]` with `init: true` in the overlay. Compose's
  `init` "runs an init process (PID 1) inside the container that forwards
  signals and reaps processes"
  ([docs](https://docs.docker.com/reference/compose-file/services/)), which
  matters because every turn leaves child processes behind;
- the base image pinned by digest, with Dependabot bumping it. The k6 and Go
  build stages are pinned by tag only. The base is Node 26.10, which is also
  what CI tests on (`.nvmrc`);
- k6 and pg-schema-diff 1.0.9 copied in, for `load.test` and the deploy's
  schema plan;
- the embedding model baked in, a layer of about 570 MB.

**Pipeline:**

- GitHub Actions builds once per push to `main` or `dev` and pushes
  `ghcr.io/diegokoes/tachy:sha-<12 characters>`. The branch name is a
  convenience tag. The digest goes into the run summary and an `image-ref`
  artifact.
- `image-cleanup.yml` keeps the 30 newest images.
- The laptop never builds. It pulls, with a classic personal access token
  carrying only `read:packages`
  ([docs](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)).
- **The registry is GHCR under the personal GitHub account.** Private packages
  come with 500 MB of storage and 1 GB of transfer, but "Container image
  storage and bandwidth for the Container registry is currently free"
  ([docs](https://docs.github.com/en/billing/concepts/product-billing/github-packages)).
  "Currently" is the risk: if that changes, move to a private Docker Hub
  repository.

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
     (`core/src/access/users.ts`).
   - Every permission check in `mcp/src/permissions.ts` (`gateUserId`,
     `requireCanEdit`, `requireGlobalAdmin`), every audit actor, and every tool
     count reads from those.

   In a shared process, every turn would act as whoever called first. Fixing
   it means moving identity into request-scoped context
   (`AsyncLocalStorage`) everywhere. A single path that loses the context,
   such as `inBackground`, which resolves the user after the tool has returned
   (`mcp/src/server.ts`), silently attributes or authorises as someone
   else.

2. **Credentials would move from one user to all users.**
   - Today the API resolves the caller's source tokens and passes only those
     into the child's environment (`mcpConfig` in `api/src/turn-config.ts`). The child has no
     `TACHY_SECRET_KEY`, and `resolveSource` falls through to those variables
     (`core/src/sources/registry.ts`, `config/credentials.ts`).
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
   `process.env` when a child starts (`loadSettingsIntoEnv`,
   `core/src/config/settings.ts`), behind a settings cache. An admin
   turning redaction on would not reach the shared server until it restarts,
   and in the meantime unredacted customer data goes to the model provider.
   Today each turn reads the setting fresh.

5. **The transport becomes a network service.**
   - stdio is a private pipe to the parent. HTTP is a port that anything on
     the Compose network can reach.
   - It would need a per-turn capability token that is minted by the API,
     bound to user, team and turn, expired when the turn ends, and checked on
     every request.
   - The MCP session id must never stand in for that token.
   - The SDK's DNS-rebinding protection is off by default: "Default is false
     for backwards compatibility"
     (`@modelcontextprotocol/sdk` 1.30.1,
     `server/webStandardStreamableHttp.d.ts`), so it would have to be enabled
     or replaced with middleware.

6. **Failures stop being isolated.**
   - A crash, a leak, or a blocking tool (PDF extraction in `ingest_context`,
     spreadsheet building in `export_table`) hits every turn at once. Today it
     hits one.
   - The event loop becomes shared, which is what §5.4 exists to avoid for
     embeddings.

**What stays true either way.**

- The agent has no shell, file or web tools. On Claude that is an allowlist:
  `tools: ["ToolSearch"]`, `settingSources: []` and `strictMcpConfig`, plus a
  deny for anything that isn't a tachý tool (`agent/src/claude.ts`). So a
  turn can't read `/proc/<pid>/environ` of another turn's child, although
  every child runs as the same `node` user. Keep it that way: it is what makes
  same-uid children acceptable.
- Uploads are rows that only their owner's turn can read (§5.6).

**Revisit** only if RAM can't grow and turns queue in normal use. Even then, do
it as its own project with the six points above as acceptance criteria, and a
security review of the result.

### 5.13 What admins see and configure

Global admins only. Everything configurable is a database setting or a job
definition. Nothing in the UI reaches the host. It lives under Admin ›
integrations, flows, workers and system.

| Area        | Shown                                                            | Configurable                                                                                    | Host or `.env` only                                   |
| ----------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Chats       | active and queued against the cap, refused, api memory           | slot cap, queue length                                                                          | api `mem_limit`, approval timeout                     |
| Embeddings  | query and passage queue depth; vectors made by another model     | -                                                                                               | the model (`TACHY_EMBED_MODEL`)                       |
| Jobs        | runs, progress, log tail, failures, next fire times, workers     | definitions: kind, params, schedule, timezone, queue, timeout, overlap, notify; run now; cancel | worker pool sizes and limits                          |
| Sources     | traffic, rate limits, auth failures                              | sync cadence, as a `source.sync` definition                                                     | -                                                     |
| Buckets     | documents, last batch, token hint                                | create, teams that may read, rotate the ingest token                                            | -                                                     |
| Flows       | runs with every step's input and output, model calls used today  | the graph, the owner, on or off, model calls a day                                              | -                                                     |
| Backups     | last backup, last restore test, downloads per person             | -                                                                                               | schedule, recipients, downloaders                     |
| Monitoring  | `tachy-watch` check states, whether the last run posted to Teams | -                                                                                               | webhook URL, since alerts must work with the app down |
| Host        | disk per mount, temperature, throttling, AC, battery, SMART      | -                                                                                               | everything                                            |
| Release     | commit, environment badge, the last deploy's image and result    | -                                                                                               | deploying and rolling back                            |
| Schema      | whether the stamped schema hash matches the image's              | -                                                                                               | applying changes                                      |
| Retention   | the 12 largest tables                                            | transcript days and usage months, as `retention.sweep` parameters                               | upload and output TTL                                 |
| Security    | SSO state, users with passwords, vault key ids                   | password login per user (`password_login_allowed`)                                              | vault key, session secret, TLS, firewall              |
| Load tests  | runs and results (§11.3)                                         | start and cancel runs; the timezone its window is read in                                       | targets                                               |
| Maintenance | whether chats are paused                                         | pause new chats before a deploy                                                                 | -                                                     |

Planned here and not built:

- a passage batch size and a thread count in settings. The batch is a
  property of the model (`batchBytes` in `core/src/search/model.ts`) and the
  thread count follows the container's CPU limit or `TACHY_EMBED_THREADS`
  (§3.3); neither is editable in the UI;
- abandoned turns on the chats panel;
- a link to the CI run for the deployed commit, and the deploy log's history;
- a real diff between the live database and `schema.sql`. The panel compares
  hashes (`core/src/infra/schema-stamp.ts`), so it can't see a dropped index
  (§5.15);
- volume sizes, and certificate expiry outside the watch row.

Host state reaches the page through read-only status files in
`/srv/tachy/status/` (§8.1). A deploy or rollback button is deliberately absent:
it needs host privileges from the web app.

### 5.14 Reranking

**Decision.** Tiers A and A+ run no reranker. From tier B, a cross-encoder
reorders the top fused candidates of every search, in the embedder service.
That happens only after it beats rank fusion on the golden set (§5.15).

- **B-cpu:** the small ms-marco-MiniLM-L-6-v2, over short text.
- **B-gpu:** bge-reranker-base.

**Why.** Rank fusion (`search/rank.ts`) knows where each leg placed a
candidate. It can't tell whether the candidate answers the query. A
cross-encoder reads both together: BAAI calls it "full-attention over the
input pair, which is more accurate than embedding model ... but more
time-consuming" ([model card](https://huggingface.co/BAAI/bge-reranker-base)).
It also gives one score per candidate, the same on every surface. Today
`relevance()` rebuilds a score from cosine, `ts_rank` and trigram similarity,
using constants measured by hand (`search/relevance.ts`).

**Measured** 2026-10-03, on the workstation:

- **Setup:** i7-12700H, transformers.js 4.3.0, onnxruntime-node 1.30.0, fp32,
  the runtime's default of one thread per core: 14.
- **Run:** one query against N candidates, as `text_pair` inputs with
  `truncation: true`, in batches of 8. Median of 5 after a warm-up.
- **Text:** "short" is about 350 characters (a code chunk), "mid" is 1000,
  and "long" is 2000 (the embedder's maximum).
- **On the laptop:** expect about 1.5× these times. It embeds at about 65% of
  the workstation's rate (§3.1).

| Model                  | Candidates | Text  | Tokens per pair |    Time |
| ---------------------- | ---------: | ----- | --------------: | ------: |
| ms-marco-MiniLM-L-6-v2 |         20 | short |              90 |  124 ms |
| ms-marco-MiniLM-L-6-v2 |         30 | short |              90 |  181 ms |
| ms-marco-MiniLM-L-6-v2 |         20 | mid   |             236 |  268 ms |
| ms-marco-MiniLM-L-6-v2 |         30 | mid   |             236 |  418 ms |
| ms-marco-MiniLM-L-6-v2 |         20 | long  |             449 |  896 ms |
| ms-marco-MiniLM-L-6-v2 |         30 | long  |             449 | 1349 ms |
| bge-reranker-base      |         20 | short |             107 | 1010 ms |
| bge-reranker-base      |         30 | short |             107 | 1460 ms |
| bge-reranker-base      |         20 | long  |             512 | 5354 ms |
| bge-reranker-base      |         30 | long  |             512 | 8115 ms |

| Model                  | Cached in the image | RSS loaded | Peak, batches of 8 | Peak, one batch of 30 long |
| ---------------------- | ------------------: | ---------: | -----------------: | -------------------------: |
| ms-marco-MiniLM-L-6-v2 |               88 MB |     264 MB |             672 MB |                    1922 MB |
| bge-reranker-base      |              1.1 GB |    2222 MB |            2222 MB |                    3029 MB |

- **bge-reranker-base doesn't fit in a search on CPU.** Even 20 short
  candidates take a second, about 1.5 s on the laptop. That is all of
  `load/search.js`'s p95 budget of 1.5 s for one search, before any other
  search runs at the same time. `knowledge_search` itself measured 260 ms at
  p95 (`load/README.md`).
- **MiniLM fits once the text is cut.** 20 candidates of about 236 tokens take
  about 0.27 s, which is where B-cpu's 256-token cut comes from.
- **Cost grows faster than length.** About 5× the tokens took 5.3–5.6× the
  time on bge-reranker-base, and 7.2–7.5× on MiniLM.
- **Threads help up to about six.** MiniLM over 30 candidates, with an
  explicit thread count on the workstation's performance cores, measured
  2026-10-05 on code text, which runs more tokens to the character than the
  table's:

  | Threads | 350 characters | 1000 characters | 2000 characters |
  | ------: | -------------: | --------------: | --------------: |
  |       1 |         927 ms |         2586 ms |         3817 ms |
  |       2 |         506 ms |         1422 ms |         2135 ms |
  |       4 |         307 ms |          965 ms |         1551 ms |
  |       6 |         228 ms |          764 ms |         1213 ms |
  |      14 |         210 ms |          783 ms |         1255 ms |
  - A rerank and a passage batch want the same threads. On B-cpu the reranker
    gets its own thread count (`TACHY_EMBED_THREADS`, §3.3), sized from this
    table.
  - `taskset` does not hold the runtime to a CPU mask: left to its default it
    pins one thread to each core of the host, mask or not. A measurement by
    cores has to set the thread count.

- **Batches of 8 bound memory and cost no time,** as with the embedder (§3.1).

**What it introduces:**

- **A step in the four search functions:** `searchKnowledge`,
  `searchReferenceDocs`, `searchCode` and `searchBucket`.
  - The SQL returns the top R fused rows instead of the page. The reranker
    scores (query, text) pairs, and the page is cut after.
  - The callers are the MCP tools and the web routes (`api/src/routes/knowledge.ts`,
    `api/src/routes/reference.ts`, the admin bucket search), so the library pays
    too.
- **The text it reads, per surface:**
  - knowledge: the entry's embed text;
  - reference: the best chunk (the `best_chunk` CTE in
    `core/src/reference/reference.ts`);
  - code and buckets: the chunk.

  On CPU it is cut to about 256 tokens.

- **Boosts on a new scale.** `CUSTOMER_BOOST`, `UNIT_BOOST` and
  `SIBLING_UNIT_BOOST` are sized in rank-fusion units (`search/rank.ts`).
  After reranking they need restating, for example as tiebreakers within a
  grade. Otherwise they stop meaning "win a tie, never bury a better answer".
- **A relevance path.** The cross-encoder's output is "not bounded to a
  specific range" ([model card](https://huggingface.co/BAAI/bge-reranker-base)).
  - A sigmoid, plus a calibration against the golden and nonsense sets, maps
    it onto 0 to 1.
  - The bands in `packages/contract/src/relevance.ts` (`GOOD` 0.35, `STRONG`
    0.7) keep their meaning, so the SPA's gauge doesn't change.
  - `SEM_FLOOR` still gates the vector leg's candidates.
- **One scale across surfaces.** `get_context` returns knowledge and reference
  hits side by side, and reranked scores compare between them.
- **A lane in `EmbedQueue`.** Reranks are query-time work, so they go ahead of
  passages along with queries. `/internal/rerank` sits beside
  `/internal/embed`.
- **A second model in the image,** cached by the Dockerfile's warmup step.
- **Two settings** in §5.13's Embeddings row: reranking on or off, and R.

**What stays.** The rank.ts rule that nonsense returns nothing still holds.
Reranking reorders the candidates the legs produced and never adds one. A
query with no candidates returns zero rows and costs no rerank.

**What gets worse:**

- **Every search pays for R forward passes,** in the library as well as in
  turns. A consult runs two searches, so it pays twice.
  - The `load/search.js` and `contention.js` baselines need re-measuring with
    reranking on.
- **The embedder grows** by the memory in the table above.
- **Calibration is per reranker,** as `SEM_FLOOR` is per embedding model. A
  reranker change is a release with a re-derived mapping, and
  `test/search/quality.test.ts` fails until then.
- **A new way to fail.** If the rerank lane is down or past its deadline, the
  search returns fused order with today's relevance and says so. It never
  fails the search.
- **Language and domain.**
  - BAAI lists bge-reranker-base for "Chinese and English".
  - MiniLM "was trained on the MS Marco Passage Ranking task"
    ([model card](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2)),
    which is web search. How well it ranks support tickets is exactly what the
    golden set has to show.

**Revisit** when a B-gpu host exists. Measure bge-reranker-base on that card,
through TEI's `/rerank` or transformers.js on CUDA (§4.6).

### 5.15 The embedding model, and changing it

**Decision.** One model embeds tickets and code: gte-modernbert-base, 768
dimensions, read for 1024 of its 8192 tokens (§3.1), fp32 through
transformers.js on CPU. Every
stored vector names the model that made it, so changing the model is a deploy
and a backfill, with no window.

**Why this model.** Measured 2026-10-05 on tachý's own repository at `dev`
(766 files), with the 45 questions of `test/fixtures/code-golden.ts`, each
naming the file that answers it. The vector leg alone, by file:

| Model                            | Right file first | In the top 3 | In the top 8 | Chunks a second |
| -------------------------------- | ---------------: | -----------: | -----------: | --------------: |
| bge-base-en-v1.5, chunks of 2400 |               12 |           16 |           23 |             4.2 |
| bge-base-en-v1.5, chunks of 1300 |               12 |           24 |           32 |             4.8 |
| jina-embeddings-v2-base-code     |               16 |           28 |           38 |             2.2 |
| gte-modernbert-base              |               28 |           37 |           42 |             1.9 |

- bge-base reads 512 tokens, and code runs about 3 characters a token: half of
  the 2400-character chunks were cut short. Chunks of 1300 fit its window.
- A model trained on code (jina) scored below a general model with a long
  window, which also needs neither a second model in memory nor a model name
  in every request.
- All three score 13 of 13 on the ticket set (`scripts/eval-embeddings.ts`).
  gte-modernbert-base separates nonsense from real matches by 0.114 there,
  against 0.087 for bge-base.
- gte-modernbert-base and jina-embeddings-v2-base-code are Apache-2.0. The
  newer code models (jina-code-embeddings, SFR-Embedding-Code) are CC-BY-NC
  and were not candidates.
- The cost is speed: half of bge-base's rate. The rates in the table are
  batches of eight on all 14 cores of the workstation, to compare the models;
  §3.1 has the rate in service.
- **Its floors are measured, per kind of text.** Against tickets nonsense
  reaches 0.541 and a terse paraphrase 0.592, so the vector leg's floor is
  0.57. Against code nonsense reaches 0.579 and a question's own file 0.637 at
  the 25th percentile, so code search's floor is 0.6
  (`semFloor`, `codeSemFloor`).

**Code search, end to end** (`scripts/eval-code-search.ts`, the same 45
questions through `searchCode`):

| Kind of question                  | Before: first / on the page | Now: first / on the page |
| --------------------------------- | --------------------------: | -----------------------: |
| a symbol as written (10)          |                       1 / 2 |                  10 / 10 |
| the symbol typed as words (10)    |                       1 / 7 |                  10 / 10 |
| a description in other words (20) |                      6 / 12 |                  11 / 17 |
| a file asked for by name (5)      |                       3 / 4 |                    2 / 5 |
| **all 45**                        |                 **11 / 25** |              **33 / 42** |

Three things changed between the columns:

- **The model,** above.
- **A lexical leg.** `code_blob_chunks.search_tsv` holds each chunk's words
  with identifiers split (`tachy_code_words`: camelCase, acronyms, snake_case,
  paths). The names a chunk defines, and for a file's first chunk the file's
  own name, are weighted above the body (`core/src/code/symbols.ts`), and a
  chunk whose symbols hold every word of the query is boosted by what one
  leg's first place is worth. Before, an identifier scored the same in every
  chunk that contained it, and a test that called a function outranked the
  function.
- **A file contributes two chunks at most,** to each leg's candidates and to
  the page. A long document that repeated a name took all fifty candidate
  places, and the file that defined it never reached the fusion.

The chunker also fills its budget now and repeats a quarter of a short chunk
at most: cut to 1300 characters, the old one produced 7394 chunks from this
repository, and the new one 4675.

**How a vector names its model.** `embedding_model` sits beside every
`embedding`, on `knowledge_entries`, `reference_doc_chunks`,
`bucket_doc_chunks` and `code_blob_chunks`. A row with none was made by
bge-base, the only model before the column existed.

- **Search reads only the current model's vectors** (`currentVector` in
  `core/src/search/backfill.ts`). Vectors of two models share no space, and a
  query embedded by one ranks the other's at random with nothing to show for
  it. A row not yet embedded again is found by its words.
- **The backfill embeds what is missing or another model's.**
  `embeddings.backfill` with no parameters does that for all four tables, and
  a run that died is picked up by the next. `all: true` still redoes
  everything.
- **The admin page says what is left:** "vectors from another embedding
  model", with a count per table.

**Changing the model** (same dimension): `deploy/runbooks/upgrades.md`.

1. The release names the model: `TACHY_EMBED_MODEL`, or the default in
   `core/src/search/model.ts`. Its entry in `EMBEDDING_MODELS` carries pooling,
   prefixes, window, batch size, and the floor and ceiling
   `scripts/eval-embeddings.ts` prints. `test/search/quality.test.ts` fails
   until they fit.
2. Deploy. From then on meaning-based search finds only what has been embedded
   again.
3. Run `embeddings.backfill`. Rows divided by the rate (§3.1) is how long it
   takes; code is most of it.
4. For code, a full reindex (`repos.refresh` with `full: true`) also cuts the
   chunks again to the new model's window. A reindex otherwise skips files
   that did not change.

A chunking change for prose is not a backfill: reference docs are re-saved
from `reference_docs.body`, and buckets are re-ingested from `bucket_docs`.

**Changing the dimension** still needs a window. On pgvector 0.8.6,
`alter table … alter column embedding type vector(N)` on a populated column
fails with `expected 4 dimensions, not 3` (a 3-dim table altered to 4, run in a
throwaway container), and succeeds once the vectors are null. The steps are in
the runbook: backup, maintenance on, null the four columns, deploy, drop the
HNSW indexes, backfill, recreate the indexes, maintenance off.

- Which hazards pg-schema-diff attaches to the type change is **to verify**.
- The maintenance switch refuses new chats and only that, and a deploy clears
  it (`refusingChats` in `api/src/lifecycle.ts`).
- HNSW indexes `vector` "up to 2,000 dimensions" and `halfvec` "up to 4,000"
  ([pgvector](https://github.com/pgvector/pgvector)).

**Keep in mind:**

- **A runtime swap still needs a check.** Moving the same model between
  runtimes (transformers.js to TEI, CPU to GPU, fp32 to a quantized file)
  keeps the weights and the name but not the arithmetic. Compare vectors for a
  sample of stored texts against a cosine threshold chosen beforehand, before
  deciding a backfill can be skipped.
- **A restore can cross a model change.** A dump taken before a change carries
  the old vectors, and the stamp is what shows that.
- **The model entry can't express every model.** nomic-embed-text-v1.5 applies
  `layer_norm` before normalizing
  ([model card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5)).
- **Not built:** a second model beside the first. `EMBEDDING_SPEC` is one
  value, and an embed request carries only `kind` and `texts`.

## 6. Durability, backup, restore

| Profile | RPO                                                                                                                      | RTO      | Mechanism                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------- |
| A       | bad write or corruption: ≤ 6 h. Host lost: the age of the newest laptop copy, at most 7 days if the reminder is acted on | ≤ 4 h    | encrypted `pg_dump` every 6 h; people download it over SFTP now and then; host rebuilt from `deploy/host/` |
| B       | ≤ 5 min                                                                                                                  | ≤ 1 h    | pgBackRest WAL archiving to separate storage; laptop downloads continue                                    |
| C       | ≈ 0 for host loss, ≤ 5 min for bad writes (PITR)                                                                         | ≤ 15 min | streaming standby and a promotion runbook                                                                  |

**What gets backed up**

| Item                                    | Backed up? | Notes                                                                                                                                              |
| --------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres                                | yes        | without the data of `generated_outputs` and `chat_uploads`, both short-lived. `library_assets` stays in: the dump is its only copy                 |
| `tachy-agent-home` (Claude transcripts) | yes, daily | small, and lets chats resume; holds customer data, so it leaves the host only encrypted                                                            |
| Secrets                                 | no         | kept in the password manager: `TACHY_SECRET_KEY`, `TACHY_SESSION_SECRET`, database passwords, the OIDC secret, the backup and break-glass age keys |
| `caddy-data` volume                     | yes, daily | Caddy's internal CA. Losing it means installing a new root on every client                                                                         |
| Deploy log (commit → digest → time)     | yes, daily | `/srv/tachy/deploy.log`, the record of what can be rolled back to, as `tachy-deploy-log-*`                                                         |
| Repo clones, model cache, images, logs  | no         | rebuildable, or retained elsewhere                                                                                                                 |

Losing `TACHY_SECRET_KEY` makes every stored credential unrecoverable
(AES-256-GCM, `core/src/infra/secrets.ts`). Each stored credential now names the
key that wrote it, so rotation is online: the old key opens its rows from
`TACHY_SECRET_KEY_PREVIOUS` until `npm run sync rotate-key` has moved them over
(`deploy/runbooks/credentials.md`). Keep the old key while any backup encrypted
with it is still held.

### 6.1 Producing backups on the host

Backups are host systemd timers, not application jobs, so they still run when
the application is broken.

1. Every 6 h, `docker compose exec -T postgres pg_dump -Fc`, as `tachy_backup`,
   writes into a root-only staging directory, `/srv/tachy/backups/staging`.
   Never under `/var`, and never inside the checkout.
2. A separate timer, Sundays at 03:45, takes a dump of its own and
   restore-tests it (§6.4).
3. `age -R /etc/tachy/backup-recipients.txt` encrypts it to
   `tachy-db-<UTC timestamp>.dump.age`. Once a day, at 02:30, the
   `tachy-agent-home` and `caddy-data` volumes go the same way, as
   `tachy-<volume>-<timestamp>.tar.zst.age`, and the deploy log as
   `tachy-deploy-log-<timestamp>.jsonl.age`.
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

A _set_ is the newest database dump, the newest archive of each volume and
the newest deploy log.
For each file, the script:

1. stops if the download would leave less than `minFreeGB` free;
2. downloads to a `.partial` file;
3. keeps the file only if `Get-FileHash` matches the `.sha256` beside it;
4. deletes sets older than the newest `keepSets`;
5. appends a line to `pulled.log` in the destination.

**Host key pinning.** `knownHostsFile` holds the host's key, which ships with
the runbook, and the script runs sftp with `StrictHostKeyChecking=yes`. The
first connection is never a "trust this host?" prompt.

**Disk.** A laptop holds `keepSets` × the dump size, plus small volume
archives. The dump measured 52 MB on 2026-09-17, so ten sets were about
0.5 GB. That figure is out of date: the code index was most of the database
then, and it has moved to `code_blob_chunks` and grown with every linked
repository. Measure again. If the dump grows large, leave the data of
`code_blob_chunks` and `repo_line_files` out of the export. Reindexing rebuilds
both, at the cost of a longer RTO.

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
  `/srv/tachy/status/backup.json`. The watch script warns when it's older than
  7 h and fails at 13 h. The admin host panel shows it, and the issues list
  raises it at 12 h.
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

- **Weekly, automated, on the host.** Restore a fresh plaintext dump into a
  scratch Postgres container with no network and a 1 GB memory limit
  (`TACHY_RESTORE_MEM_LIMIT`), on the image the Compose file names.
  Then tear the container down and ping a separate check. It compares with
  production:
  - row counts, within 1%;
  - `embedding is null` counts on the four embedded tables (§5.15);
  - the schema stamp against the hash of `db/schema.sql`. An unstamped database
    passes. This is not a schema diff.
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
- **Remote access** is LAN only for now. The host is prepared for Tailscale in
  case IT allows it: installed, but not joined to a tailnet. Tailscale's free
  Personal plan is "only suitable for non-commercial use"
  ([pricing](https://tailscale.com/pricing)), so this means IT's tailnet or a
  paid plan, not a personal account. The nftables rule for 443 and 22 then adds
  the `tailscale0` interface.
- **Downloads from home** are allowed over Tailscale, once it exists. Each
  downloader's `from=` then covers the office LAN and `100.64.0.0/10`, the
  tailnet's address range.
- The host firewall has two parts. nftables guards port 22, for admin
  machines and the backup downloaders' network (§6.2). Ports 80 and 443 are
  published by Docker, which bypasses nftables' input chain, so an iptables
  `DOCKER-USER` rule limits them to the LAN (`deploy/host/templates/tachy-edge.sh.j2`).
- SSH is key-only, with no root login. `AllowGroups` limits it to the admins
  and `tachy-backup`, and the backup group gets read-only SFTP in a chroot and
  nothing else.
- Caddy adds HSTS and security headers, and one 26 MB body limit (§5.7).
- Password login is always installed (`api/src/index.ts`), including under
  `TACHY_AUTH_MODE=sso`. Under SSO it works only for accounts flagged
  `password_login_allowed`: one break-glass admin and the load-test user.
  Service accounts (`service_account`) are left out of engagement figures. Its
  throttle is an in-process `Map`.
- **The ingest endpoint is the one route a session doesn't open.**
  `POST /ingest/buckets/:slug/batches` (`api/src/routes/ingest.ts`) takes
  documents pushed by a script outside tachý, such as the Document360 sync on
  a Windows machine.
  - Each bucket has its own bearer token. It opens that bucket's ingest and
    nothing else, and neither a session nor the API token opens the route.
  - The token is shown once, stored as a hash, compared in constant time, and
    rotated from the admin page.
  - A batch is at most 16 MB.
  - Ten failed tokens in a minute from one address stop that address, for that
    bucket, for the rest of the minute. Other addresses and buckets are
    unaffected, so a guesser cannot lock a pusher out. The address is
    `X-Forwarded-For`, read because the api runs with `TACHY_BEHIND_PROXY=true`
    here and which Caddy sets itself: "For these `X-Forwarded-*`
    headers, by default, the proxy will ignore their values from incoming
    requests, to prevent spoofing"
    ([Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)).
    The route is reachable from the LAN only.
  - The pusher reaches Document360, not the host, so the host's egress list
    doesn't grow.

**Containers**

- `init: true`, and `USER node` (already in place).
- `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`,
  `read_only: true` with a tmpfs for `/tmp`, and a `pids_limit`, on every
  service. The `pids_limit` is the backstop for runaway turn trees.
- `postgres` keeps the five capabilities its entrypoint needs to own its data
  directory and step down from root (CHOWN, DAC_OVERRIDE, FOWNER, SETGID,
  SETUID), and has a tmpfs for its socket directory too.
- No container mounts the Docker socket. The watch script runs on the host,
  outside every container.
- `/srv/tachy/status` is mounted read-only into `api`, so the admin page can
  show backup and host state without any access to the host.
- Operators aren't in the `docker` group, which is root-equivalent. Deploys run
  as `tachy` through the deploy script.
- The internal secret (`TACHY_INTERNAL_SECRET`) is one static value shared by
  the api, the embedder, the workers and every MCP child. It opens
  `/internal/embed` and `/internal/log`, which read and write nothing (§5.4).

**Database and secrets**

- Least-privilege roles (§5.9), and generated passwords. The overlay refuses
  to start without `POSTGRES_PASSWORD`.
- `.env` is mode 0600 and owned by `tachy`, with every secret also in the
  password manager. The first-install runbook sets the mode; the playbook
  doesn't. `.dockerignore` keeps `.env` out of the image.
- The per-turn MCP env isolation invariant stays as it is: caller-scoped
  tokens, built fresh for each turn (`api/src/turn-config.ts`).
- **The workers hold the vault key.** A flow acts with its owner's source
  tokens and model credential (§5.3.7), so `worker-light` decrypts them. A turn
  has a person approving its writes. A flow doesn't, which is why its model
  calls are limited per day.
- Rotation is in `deploy/runbooks/credentials.md`: the session secret (it logs
  everyone out), the API token, source tokens, provider keys, and the vault
  key, which rotates online.

**Host**

- LUKS full-disk encryption, unlocked by TPM2 (`systemd-cryptenroll`) so the
  laptop comes back unattended after a power cut. It is a laptop, and laptops
  get stolen. This is a manual step in `deploy/runbooks/replace-host.md`, not
  in the playbook.
- unattended-upgrades for Debian security updates. Docker comes from Docker's
  apt repository with the major version pinned.

**Data handling**

- **Retention** is the `retention.sweep` job, daily at 03:30 UTC
  (`core/src/compliance/retention.ts`):

  | Data                              | Kept                                           |
  | --------------------------------- | ---------------------------------------------- |
  | exports, chat uploads             | 24 h                                           |
  | Claude transcripts                | 90 days from last activity                     |
  | `library_views`, `mcp_tool_calls` | per person per day for 13 months, then monthly |
  | job runs                          | 90 days, failed ones 180                       |
  | orphaned library images           | 7 days                                         |
  | container logs                    | 200 MB per container (§8.1)                    |
  | `source_calls`, `analysis_runs`   | forever: they hold counts, not content         |
  | flow runs                         | 90 days, failed ones 180                       |
  | notifications                     | 90 days once opened, 180 if never              |

  `turn_events` (profile B) will keep 24–72 h.

  A transcript is a Claude Code session file under `users/<id>/` in the
  `tachy-agent-home` volume: every prompt, tool call and tool result of a chat,
  customer ticket content included, and what lets the chat be resumed. Whether
  Claude Code's own `cleanupPeriodDays` also deletes them, and sooner, is **to
  verify**: tachý passes `settingSources: []` (`agent/src/claude.ts`), so the
  default applies.

- Backups leave the host only as age ciphertext, and the key that opens them
  lives only in the password manager (§6.1).
- Every HTTP log line carries the user's email (`api/src/logging.ts`). That's
  fine operationally, so reading container logs stays limited to the operators
  who can run `docker compose logs`. Bodies and tokens
  are never logged, and that must stay true.
- Egress the host needs:
  - the model provider (Anthropic);
  - the sources (Freshdesk, GitHub, Azure DevOps) and the linked git remotes;
  - GHCR, to pull images;
  - the Teams workflow URLs and healthchecks.io;
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

**Runtime state in the admin page.** `/api/system` carries a `runtime` block
for admins (`api/src/runtime.ts`), current values only, with no time series:

- turns active and queued against the slot cap, and refused since boot;
- the api container's memory from its own cgroup (`memory.current` against
  `memory.max`), which is the capacity signal, since turn trees live there;
- event-loop delay p99 over the last minute (`perf_hooks.monitorEventLoopDelay`);
- embed queue depth and in-flight count;
- Postgres connections by `application_name` from `pg_stat_activity`. Each
  process sets its own `application_name`, since postgres.js exposes no pool
  statistics;
- pending approvals and the oldest one's age;
- job health: how many definitions, runs and queues need a hand, by issue,
  which is what the watch script alerts on;
- the host state files from `/srv/tachy/status/` (backup, restore test,
  downloads, disk, temperature), mounted read-only.

This is a narrow exception to keeping infrastructure figures out of the
product: with no metrics stack, the admin page is the only place an operator
can see load. It shows the present moment and stores nothing.

**Business metrics.** The admin overview already answers who, which and how
much: library reads, tool calls per person, source traffic by origin,
rate-limit and auth refusals, and wiki gaps (`api/src/routes/admin/overview.ts`).
Turns and cost per user and team come from `analysis_runs`.

**Logs.** The Docker `local` log driver, compressed and rotated by size: 20 MB
× 10 files per container, so about 200 MB each. The limit is size, not age: a
quiet container keeps months and a busy one keeps days.

- Every line is one JSON object with an `event` field (`http`, `mcp_tool`,
  `repo_index_failed` and so on) and a request id, so
  `docker compose logs api | grep <request-id>` follows a request.
- **MCP children can't log to the container.** Claude Code doesn't pass an MCP
  server's stderr on (verified 2026-09-17). So a child posts each line to the
  api's `POST /internal/log`, with the internal secret, and the api writes it
  with `source: "mcp"`, the turn id and the request id.

**Tracing.** Deferred. Revisit only when turn latency can't be explained from
logs.

### 8.2 The host watch script

`tachy-watch`: a shell script (bash, curl, jq) at `deploy/watch/tachy-watch`,
run every minute by a systemd timer, as root.

- Every check reports ok, warn or fail. The script keeps the last state per
  check in `/var/lib/tachy-watch/state.json`, and posts to the Teams workflow
  webhook only when a state changes. A check still failing is reposted every 4
  hours.
- Each post carries the check, the value, the threshold, and a link to the
  admin page.
- When everything passes, the script pings the external heartbeat. If the host,
  Docker or the script dies, the pings stop and the external service alerts,
  through email or its own Teams integration. The service is healthchecks.io,
  with one check each for backups, the restore test and `tachy-watch`.

| Check                | Source                                                                | Warn                                                                  | Fail                                                        |
| -------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| readyz through Caddy | `curl https://<name>/readyz`                                          | 1 failure                                                             | 2 consecutive failures                                      |
| 5xx rate             | `docker compose logs --since 10m api`, `status >= 500`                | > 1%                                                                  | > 5%                                                        |
| api memory           | `docker stats` for the container, against its limit                   | > 85%                                                                 | an OOM kill in `docker events`                              |
| turns queued         | `/api/system` with the API token                                      | queued > 2 min                                                        | queued > 5 min                                              |
| jobs                 | the same response's job health                                        | a last run failed, a run queued over 15 min, or a definition disabled | a schedule overdue, or a queue with runs and no live worker |
| Postgres connections | `psql` as `tachy_watch`: `pg_stat_activity` count / `max_connections` | > 80%                                                                 | > 95%                                                       |
| long transaction     | `pg_stat_activity`                                                    | > 5 min                                                               | > 10 min                                                    |
| disk, per mount      | `df /var /srv /`                                                      | > 80%                                                                 | > 90%                                                       |
| backup age           | `/srv/tachy/status/backup.json`                                       | > 7 h                                                                 | > 13 h, or a failed run                                     |
| restore test         | `/srv/tachy/status/restore.json`                                      | > 8 days                                                              | a failed run                                                |
| laptop downloads     | `/srv/tachy/status/downloads.json`                                    | none in 7 days                                                        | fewer than 2 people in 30 days                              |
| certificate          | `openssl s_client` against 443                                        | < 14 days (internal CA: < 2 h)                                        | < 3 days (internal CA: < 30 min)                            |
| thermal throttling   | `package_throttle_count` delta                                        | throttling 10 of the last 15 min                                      | 30 of the last 30 min                                       |
| AC power             | `/sys/class/power_supply/A*/online`                                   | on battery                                                            | battery < 30%                                               |
| NVMe health          | `smartctl -H`, `nvme smart-log` media errors                          | spare < 20%                                                           | SMART failed, media errors                                  |

Caddy's internal CA issues 12-hour certificates and renews them itself, so
for it the check asks whether renewal is keeping up.

**A schedule is overdue** when its slot passed more than 5 minutes ago and no
run was queued for it. Every worker schedules, so that is what a host with no
worker running looks like: nothing queues and nothing fails.

**The Teams webhook** is a Workflows webhook. It needs no Entra app
registration. Microsoft 365 Connectors "are nearing deprecation, and the
creation of new Microsoft 365 Connectors will soon be blocked", and the
replacement is the **When a Teams webhook request is received** trigger
([docs](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook)).
Two caveats:

- "Workflows are linked only to specific users", so give the workflow a
  co-owner, or it goes orphaned when its owner leaves;
- the Workflows app must be allowed in the tenant, which is an IT question.

The webhook URL is a secret, so keep it in the password manager.

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
release, and any time someone reports slowness.

Two of these are targets without a measurement yet:

- **Availability.** The watch script keeps only the latest state of each check,
  so nothing sums readyz results over a month.
- **Latency.** Only `load/mixed.js` uses these numbers as thresholds.
  `browse.js` and `search.js` carry their own.

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
- `/health` is an alias of `/livez` for existing probes. Detailed diagnostics
  are in `/api/system`, which shows its `env` block only to admins.
- In production "the model is warm" means the embedder's own `/readyz`
  answers (`api/src/lifecycle.ts`).

**Shutdown on SIGTERM**

1. readyz returns 503.
2. New turns are refused with a retryable error.
3. In-flight turns get up to the drain period to finish. Make it a few minutes,
   and accept that a turn waiting on approval gets cut.
4. Timers are flushed, the pool is closed, and the process exits.

`stop_grace_period` is set above the drain period: 210 s against a 180 s drain
(`TACHY_DRAIN_SECONDS`) for the api, and 90 s against 60 s for the workers. The
Compose default is 10 s, and the base `docker-compose.yml` alone still has it.

**Crash-only for everything else.** Docker restarts containers on exit, not on
health. So an unrecoverable state should exit the process rather than sit there
unhealthy. The model failing to load does that. So does a pool with no free
connection: a probe every 30 s that waits 10 s for one, six times in a row,
drains the api and exits 1 (`watchPool` in `api/src/lifecycle.ts`). A probe
that fails counts as answered, because Postgres being down fails at once
(measured: 4 to 9 ms with postgres.js), and the api rides that out.

## 10. CI/CD

**GitHub Actions**

| Workflow            | Runs on                                                 | Does                                                                                                       |
| ------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ci.yml`            | pull requests; pushes to `main` and `dev`               | `build`: typecheck, `web:check`, the server build, `coverage` with its ratchet at 74/72/71/63              |
|                     | pushes only                                             | builds the image once and pushes `sha-<12 characters>` and the branch tag to GHCR; records the digest      |
|                     | both                                                    | `secrets`: gitleaks                                                                                        |
| `image-gates.yml`   | pull requests that touch the image                      | a Buildx build, a Trivy scan that fails on critical findings with a fix, and the container smoke test      |
| `schema-plan.yml`   | pull requests that touch `db/schema.sql` or `roles.sql` | loads the merge-base schema and fixtures, diffs to the PR's schema, applies, and requires an empty re-diff |
| `load-scripts.yml`  | pull requests that touch `load/`                        | bundles every k6 script on a pinned k6 image                                                               |
| `image-cleanup.yml` | a schedule                                              | keeps the 30 newest images                                                                                 |

- **The container smoke test** starts the built image with the base Compose
  file and a CI `.env` (token auth), waits for readyz, seeds a small database
  and runs `load/smoke.js` (`scripts/container-smoke.sh`). It catches what
  vitest can't: file permissions as `node`, missing env, the SPA build, the
  image layout. It doesn't run the production overlay, so a read-only root
  filesystem and the `tachy_app` role are never exercised in CI.
- **`schema-plan`** uploads the plan as an artifact. Destructive hazards fail
  the job unless the pull request carries the `schema-destructive` label.
- **`build`, `image-gates`, `schema-plan` and `secrets` are required checks**
  on `dev` and `main`, in a ruleset per branch. Both
  path-filtered workflows filter in a job of their own, so their checks report
  on every pull request and can be required: GitHub leaves the check of a
  workflow skipped by a path filter pending, and counts a job skipped by a
  condition as passed
  ([docs](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)).
- **Images built on a push aren't scanned.** Trivy runs on pull requests only.
- **Dependabot** covers npm, Docker, Compose files and GitHub Actions, weekly,
  into `dev`.

**The environment badge is runtime, not build-time.** The image never knows
which environment it's in:

- the api reads `TACHY_ENV_BADGE` from the stack's `.env`: `dev` on the dev
  stack, unset on production;
- it sends the badge to the SPA in `/auth/config`, next to `passwordLogin`
  (`api/src/app.ts`), and the SPA renders it;
- `/api/system` reports the badge beside the commit.

So promoting a digest from dev to main needs no rebuild.

**Deploy (pull).** `tachy-deploy <commit|branch>` runs on the host
(`deploy/host/tachy-deploy`):

1. refuse to start when the smoke login (`SMOKE_EMAIL`, `SMOKE_PASSWORD` in
   `/etc/tachy/tachy.env`) is not set, unless `--skip-smoke` is given;
2. resolve the argument to a commit and pull `sha-<12 characters>`;
3. bring the `vector` extension level with the image, then plan the schema
   diff with the pg-schema-diff in the new image. Stop if the plan is
   destructive and `--allow-destructive` wasn't given;
4. take a full encrypted backup (`tachy-backup db`);
5. apply the plan and stamp the schema hash;
6. apply the new commit's `db/roles.sql` and the role passwords from `.env`;
7. check out the commit and recreate every changed service. Each one drains on
   SIGTERM (§9);
8. wait up to 5 minutes for readyz through Caddy, then run `load/smoke.js`;
9. on failure, roll back to the previous commit and image. The schema is not
   reverted;
10. append commit, image, schema result, whether smoke ran, and the outcome to
    `/srv/tachy/deploy.log` and to the status files the admin page reads.

**Deploy by itself.** `tachy-update` (`deploy/host/tachy-update`) runs from a
timer at 01:15 and 04:45 and calls `tachy-deploy` with the head of
`TACHY_UPDATE_BRANCH` when that is not what runs. It is off until the branch
is set. The host pulls, so nothing has to reach it. It waits for CI's image,
and it does not try again a commit that was refused or rolled back:
tachy-watch's `update` check fails until someone looks.

Rollback is `tachy-deploy <previous commit>`. It is safe only when the previous
image accepts the current schema, which is what expand and contract is for.

**Dev stack.** The same flow, from `dev`, on its own machine (§15.1), with
`TACHY_ENV_BADGE=dev` in its `.env`. It doesn't run on the office laptop.

## 11. Testing strategy

| Layer                | Tool                                                           | Status                               |
| -------------------- | -------------------------------------------------------------- | ------------------------------------ |
| Unit and integration | vitest, testcontainers Postgres, coverage ratchet              | in CI, required                      |
| Search quality       | `test/search/quality.test.ts`, `scripts/eval-embeddings.ts`    | in CI; 14 golden queries (§4.6)      |
| Schema drift         | `test/infra/schema-drift.test.ts`, plus `schema-plan` (§10)    | in CI                                |
| Container smoke      | `image-gates.yml` (§10)                                        | in CI, on the base Compose file only |
| Load and capacity    | k6, `load/turns.mjs`                                           | scripts built; no laptop numbers yet |
| Backup restore       | weekly host timer; quarterly drill from a laptop copy (§6.4)   | built; not yet run on the laptop     |
| Browser end-to-end   | Playwright: login, search, open entry, chat against a mock LLM | not built; optional                  |
| Chaos drills         | manual, every quarter                                          | not yet run                          |

### 11.1 k6

| Script          | Role                                                                                 |
| --------------- | ------------------------------------------------------------------------------------ |
| `smoke.js`      | the post-deploy gate; reaches every route family once                                |
| `browse.js`     | 20 rps over the read paths a person clicks through                                   |
| `search.js`     | 1 → 10 rps, or 5 → 50 with `PROFILE=stress`                                          |
| `soak.js`       | 2 rps for 30 minutes; memory and pool behaviour                                      |
| `contention.js` | search at 5 rps during an embedding backfill; p95 must stay within 1.5× the baseline |
| `mixed.js`      | a day's traffic; its weights are placeholders until a week of real traffic exists    |
| `spike.js`      | 0 → 30 rps in 10 s, the morning login burst. No 5xx, and it recovers                 |
| `breakpoint.js` | ramps until search misses 1.5 s, and records the knee per release                    |
| `turns.mjs`     | 1 → N concurrent chat turns against a mock model                                     |

- **`turns.mjs` costs nothing to run.** `load/mock-llm` speaks the Anthropic
  Messages API and returns scripted tool calls. Claude Code is pointed at it
  with `ANTHROPIC_BASE_URL`, the documented gateway variable
  ([docs](https://code.claude.com/docs/en/llm-gateway)).
  - It measures turn latency, MCP spawn time, api memory against the number of
    turns, and Postgres connections: the per-turn figure for §3 and the cap.
  - It is a Node driver, not a k6 script, because k6 reads a whole SSE body
    and so can't time the first event.
- **`contention.js` is the test that proves the embedder and worker
  separation.** It hasn't run on the laptop.
- **Logins.** The scripts sign in with a password (`load/session.js`), as
  a user flagged `service_account`, so load never shows in engagement figures.
- **The only measured baseline comes from a workstation.** The laptop's
  numbers are still needed.
- **k6 is pinned in two places,** the `Dockerfile` and `load/k6.compose.yml`,
  and Dependabot bumps both. `tachy-deploy`, `scripts/container-smoke.sh` and
  the load-scripts workflow read the image from the Compose file.

**Where load runs.** Never against production while people are using it.

- **Functional checks and heavy scripts** (`soak`, `spike`, `breakpoint`,
  `PROFILE=stress`) run against the dev stack, wherever it lives (§15.1). Seed
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
with the commit, and compared release to release on the admin page.

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

**Where.** A `tests` section under Admin › system, visible only to global
admins.

**What it shows:**

1. **Checks.** Fast, and safe to click at any hour. Each one is a pass, warn,
   fail or skip row with the detail behind it (`core/src/diagnostics/checks.ts`):
   - the database answers;
   - the embedding model answers, and one query embeds within budget;
   - the vault key decrypts a stored credential;
   - every source connection answers its test call;
   - each configured agent backend has a credential.
2. **Load runs.** An admin picks a script, a profile and a target, then
   presses start. The panel shows progress, and when the run ends, pass or
   fail per threshold with p95 for each `endpoint` tag. Each result sits
   beside the previous run of the same script, with both commits.

Backup age, the last restore test and disk are on the host panel, not here.
A link to the CI run for the deployed commit is not built.

**How a load run executes.** The api never spawns k6 itself. k6 in the api
container would compete for the CPU it's measuring, and driving Docker from
the api needs the Docker socket, which §7 rules out.

- A `test_runs` row per run: `script`, `profile`, `target`, `status`
  (`queued`/`running`/`passed`/`failed`/`cancelled`/`error`), `requested_by`,
  `image_sha`, `summary` (jsonb, from k6's `handleSummary`), `output_tail`,
  and timestamps. One run at a time.
- A `load.test` job (§5.3.7) on the `testing` queue. `worker-heavy` claims it
  and spawns `k6 run` with the script from `load/` in the image. So a load run
  takes the heavy pool's one slot, and 3 chat slots, while it runs.
- The runner streams the tail of k6's output into `output_tail` and writes the
  summary when k6 exits. Cancel becomes SIGINT, and k6 still writes its
  summary.

**Guardrails** (`core/src/diagnostics/load-runs.ts`). These carry the rule from
§11.1: never load production while people are using it.

- Targets come from `TACHY_LOAD_TARGETS`, not from free text, so the page
  can't be turned into a load generator aimed at anything else.
- Against a production target, only `smoke.js` is allowed at any time. The
  other scripts are allowed only in the off-hours window: weekdays
  19:00–07:00, and weekends.
- The window is read on the organisation's clock (`org_timezone`, §5.3.2). A
  container's own clock is UTC.
- `soak`, `spike`, `breakpoint`, `mixed` and `PROFILE=stress` run only against
  a dev target.
- A dedicated load-test user, flagged `service_account`: member role, no team
  write rights, left out of engagement analytics.
- `turns.mjs` isn't started from the page. It runs in a load window, against
  a target whose agent backend points at the mock model, never against a real
  provider key (`deploy/runbooks/load-window.md`).
- Every run is recorded against the admin who started it.

**Results.** `test_runs` is the only store. Its history is the latency record
for §8.3.

**Why not `npm test` from the admin page.** It doesn't fit, for four reasons:

- The suite tests a commit, not an environment. CI has already run it on the
  exact SHA the image was built from, so a rerun on the host can only reproduce
  that result or fail for reasons unrelated to the deployment.
- It needs devDependencies (vitest, testcontainers), and the image doesn't
  ship them (§5.11).
- testcontainers starts Postgres through the Docker socket, which is
  root-equivalent, and §7 keeps it out of every container.
- It truncates and seeds its own schemas. Running it next to production data is
  the kind of mistake the `NODE_ENV=production` refusal on `seed` exists to
  prevent.

The checks, the post-deploy smoke run and the restore test cover what really
does vary per environment.

## 12. Operating a laptop as a server

- **Measured 2026-09-17:**
  - ThinkPad E14 Gen 2, i7-1165G7 (4 cores, 8 threads, 400–4700 MHz), 15 GiB
    usable RAM, 976 MB swap. The whole stack uses about 420 MB at idle (api
    286 MiB, postgres 137 MiB).
  - Samsung 512 GB NVMe: `/` 30 G, `/var` 12 G (40% used, 3.8 G of it
    containerd), `/srv` 432 G. SMART: 1% used, 0 media errors, 603 power-on
    hours, **24 unsafe shutdowns**, so it has lost power or been forced off
    before, and the clean-shutdown work below matters.
  - Gigabit Ethernet with link up, Wi-Fi down. Suspend targets are masked.
  - Battery at 98% of its design capacity after 82 cycles, with
    `charge_control_end_threshold=100`, so the 80% cap below isn't
    set yet.
  - **Sustained all-core load** (`stress-ng --cpu 8`, 5 minutes, PL1 35 W):
    the package reached 86 °C within 30 s and held at 89 °C, 11 °C below its
    100 °C limit. Throttling began at about 60 s, and the average frequency
    fell from 4100 to 3700 MHz, about 10%. The fans barely rose (3200 to 3400
    RPM). After 30 s idle it was back to 50 °C. So the laptop keeps about 90%
    of its peak speed under sustained load, which is fine for embedding bursts.
    The worker's CPU cap (§3) should still keep long reindexes from running
    near the limit for hours.
- **Disks.** Docker's data-root and containerd's root both live on `/srv`
  (`deploy/host/tasks/docker.yml`). `docker info` reporting `/srv/docker`
  doesn't prove images moved, because with the containerd snapshotter the
  layers live under containerd's own root. Check with `df -h /var /srv`.
  journald is capped at 1 GB.
- **Battery.** Hold the charge at about 80%: ThinkPad
  `charge_control_end_threshold` via TLP, or IdeaPad conservation mode. A
  battery held at 100% around the clock ages quickly and can swell.
- **Power loss.** The battery is a small UPS. Alert on AC loss, and let upower
  shut the host down cleanly at about 15%.
- **Heat.** Give it airflow, and never stack it. Alert on sustained high
  throttling (§8.2). Reindexing capped at 4 threads helps.
- **Suspend.** Suspend on lid close is off: a logind drop-in plus masked sleep
  targets.
- **Network.**
  - wired Ethernet;
  - a DHCP reservation, pending with IT;
  - an internal DNS name, never an IP, because the certificate and the OIDC
    redirect URI bind to it.
- **Updates.** unattended-upgrades for security fixes. A monthly window for
  Docker and the kernel, with a reboot, which also tests unattended boot. The
  Postgres image changes only through a pinned-tag bump followed by a restore
  test.
- **Provisioning as code.** Everything in this section is an idempotent
  Ansible playbook under `deploy/host/`, run from the operator's machine with
  `--ask-become-pass`. It has not been run on the laptop yet (§13):
  - users, SSH, the firewall and Docker;
  - the downloader logins and the SFTP chroot, from `backup_downloaders` (§6.2);
  - the systemd units: `tachy.service`, the backup and restore-test timers,
    `tachy-watch` and the heartbeat, the deploy script.

  The RTO for a dead laptop depends on this.

## 13. Phases and exit criteria

### Phase 1: make the laptop safe

**Built:** Caddy with TLS, the production overlay and
its limits, Postgres roles and pools, health and drain, admission control, one
embedding model, the compiled MCP child, backups and the downloader script,
`tachy-watch`, `tachy-deploy` with rollback, the host playbook and the
runbooks.

**Exit when:**

| Criterion                                                                                                            | State on 2026-10-03                                             |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| only 443 is reachable from the LAN, and SSO works over https                                                         | open: needs the playbook run and the Entra registration (§15.1) |
| stopping `api` during a turn lets it finish or fail inside the grace period, and `docker events` shows no SIGKILL    | shown on the built image; open on the laptop                    |
| 15 concurrent mock turns run in a load window with api memory under 85% of its limit, and a 16th queues              | shown with a cap of 2 on a workstation; open on the laptop      |
| `load/turns.mjs` measures a Claude turn at 0.55 GB or less at p95                                                    | 0.17 GB on the workstation (§3.1); open on the laptop           |
| two people have downloaded a set; a restore from a laptop copy has been timed; the restore test is green for 2 weeks | open                                                            |
| every check in §8.2 has posted to Teams once, and unplugging the network trips the external heartbeat                | shown against a capture server; open against Teams              |
| a deliberately broken image rolls itself back                                                                        | shown off the laptop                                            |
| the same digest runs on the dev and production stacks, with the badge only on dev                                    | built; open until a dev stack exists (§15.1)                    |
| a reindex of the largest linked repo while `smoke.js` runs against production: smoke still passes                    | open                                                            |

### Phase 2: separation on one host

**Built:** the job layer and its admin UI, the two
worker pools, the embedder service, uploads in Postgres, the compiled build,
the image gates and schema plan in CI, schema changes by diff, the admin
system pages and tests section, and key ids for the vault.

**Exit when:**

| Criterion                                                                            | State on 2026-10-03                             |
| ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `contention.js` holds search p95 within 1.5× the baseline during a reindex           | open: needs a laptop load window with real data |
| the slot cap has been raised from measurements, or the reason it can't be is written | open, for the same reason                       |
| a schema change has shipped by diff, without a dump and restore                      | done, on a live stack                           |
| one request id can be followed across api and MCP log lines                          | done                                            |
| both new CI jobs are required checks                                                 | done (§10)                                      |

**Still to do by hand,** for both phases: run the playbook on the laptop, the
two Teams workflows and the healthchecks.io checks, the backup keys and the
downloaders, an Entra registration for SSO, and the load windows that produce
the laptop's own numbers.

**To verify on the laptop:** the sshd log wording `tachy-watch` parses for
downloads, and `Get-TachyBackup.ps1` under Windows PowerShell 5.1.

### Phase 3: department server (profile B)

**Work**

- the `agent` service with `turns` and `turn_events`, resumable SSE, and
  approvals through the database;
- a stateless API ×2 under `docker-rollout`;
- Postgres on its own host, with pgBackRest;
- a replacement-host drill;
- the search tier for the host bought (§4.6), one step at a time. Each step
  (query instance, reranker, GPU runtime) ships only after it beats
  the step before on the golden set (§5.15).

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

## 14. Runbooks

All in `deploy/runbooks/`. `README.md` there is the index.

| Runbook                  | Covers                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `first-install.md`       | from `deploy/host/` through to the setup wizard; a database from before the schema stamp   |
| `deploy-and-rollback.md` | deploying, rolling back, reading the deploy log                                            |
| `schema-change.md`       | reading the plan, destructive changes, expand and contract, the dump-and-restore fallback  |
| `maintenance.md`         | draining, the monthly update window                                                        |
| `credentials.md`         | rotating the session secret, the API token, source tokens, provider keys and the vault key |
| `backups-and-restore.md` | adding a downloader, restoring, the quarterly drill, rotating the team backup key          |
| `replace-host.md`        | replacing a failed laptop or server, including LUKS and TPM2                               |
| `full-disk.md`           | a disk alert, including the `/var` partition                                               |
| `upgrades.md`            | Postgres and pgvector; the embedding model or vector dimension (§5.15)                     |
| `investigation.md`       | a slow search, a stuck or expensive turn, a failed sync, a failed index                    |
| `jobs-and-flows.md`      | a job or a flow that keeps failing; nothing running them                                   |
| `onboarding.md`          | adding a team, a source connection, a linked repo or a bucket                              |
| `housekeeping.md`        | certificates, retention, incident ownership                                                |
| `tls-client-trust.md`    | installing Caddy's root certificate on clients                                             |
| `load-window.md`         | measuring on the laptop outside working hours (§11.1)                                      |

## 15. Open questions and known gaps

### 15.1 Waiting on a decision or on someone

- **Name.** The internal DNS name, and whether IT will later issue a
  certificate for it. TLS itself is decided (§5.7); the notes below are the
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
     appears in public Certificate Transparency logs. This needs a Caddy build
     with the DNS provider's module, which the stock image lacks (§5.7).
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
- **A GPU for profile B.** It decides between tier B-cpu and B-gpu (§4.6), and
  so whether bge-reranker-base is affordable at all (§5.14).
- **Languages in tickets.** If tickets arrive in languages other than English,
  a multilingual model such as bge-m3 becomes a candidate (§5.15).
  gte-modernbert-base is an English model, and BAAI lists bge-reranker-base
  for Chinese and English.
- **The golden set.** Who collects 50 or more real queries with their expected
  answers (§5.15). Every model and reranker decision waits on it.

### 15.2 Known gaps

None of these blocks a deploy.

- **The slot cap is still 15.** The laptop's load window (§3.1) held 40 short
  turns in memory, with first events slowing from 3.4 s at 15 to 5.5 s at 25.
  Raising it is a setting in Admin › system; real conversations are longer
  than the test's.
- **One-shot model calls take no slot** (§2.4). In the api each adds about
  100 MiB outside the turn budget.
- **`tachy_owner` does not exist** (§5.9), so the schema is applied as the
  bootstrap superuser.
- **`resource_class` is still written** on `job_definitions` and `job_runs`
  beside the queue that implies it (§5.3.2), and three queries read it.
- **Planned and not built** are listed where they were planned: §3.3, §5.3.4,
  §5.9, §5.13 and §8.3.
- **Search** has its own findings in §4.6 and §5.15.
