# Load tests

k6 scenarios for the dev stack. They are read-only: nothing here writes to the
database, so a run is repeatable and a failure is never a data problem.

## Running

The dev stack must be up and seeded:

```sh
docker compose -p tachy-dev up -d
docker compose -p tachy-dev run --rm cli npm run sync -- seed --scale=medium --reset --yes
npm run load -- /load/smoke.js
```

`npm run load` runs k6 as a container on the dev project's network, so the API
is reachable as `http://api:8787` (the host-side 8788 mapping is only for a
browser). To point it somewhere else:

```sh
BASE_URL=http://localhost:8788 npm run load -- /load/smoke.js
```

For k6's live TUI, install it locally instead (`apt install k6` from the Grafana
repo) and run `BASE_URL=http://localhost:8788 k6 run load/smoke.js`.

## The scenarios

| Script      | Shape             | What it is for                                                                                     |
| ----------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `smoke.js`  | 1 VU, 1 iteration | One call to every endpoint. Run it after every deploy; it takes seconds and every check must pass. |
| `browse.js` | 20 rps for 2 min  | The read paths a person clicks through: list, detail, facets, download.                            |
| `search.js` | 1 → 5 → 10 rps    | The two embedding-backed endpoints. This is the one that finds the ceiling.                        |
| `soak.js`   | 2 rps for 30 min  | Memory and pool behaviour over time, not latency.                                                  |

`PROFILE=stress npm run load -- /load/search.js` swaps search to 5 → 25 → 50 rps
and drops the latency bar. Stress is for finding the knee, not for passing.

Overridable: `RATE`, `DURATION`, `BASE_URL`, `LOGIN_EMAIL`, `LOGIN_PASSWORD`.

## Reading the results

Every request is tagged, so the per-endpoint rows are the ones that matter:

```
{ endpoint:knowledge_search }...: avg=161ms p(95)=259ms
```

To chase a slow request, take its `x-request-id` response header and grep the
API log — every request logs one JSON line carrying the same id:

```sh
docker compose -p tachy-dev logs api | grep <request-id>
```

### Measured baseline

On a developer workstation against a `--scale=medium` seed (5k work items, 4k
knowledge entries, 21k vectors), at 10 rps:

- `knowledge_search` p95 ≈ 260 ms, `reference_search` p95 ≈ 55 ms, no failures.

The office laptop is slower than this, so treat it as an upper bound on what
good looks like rather than a target. The thresholds in `search.js` are set
well above it deliberately — they are there to catch a regression that changes
the shape of the curve, not to grade the hardware.

## What is deliberately not tested

- **`POST /api/agent/chat`** — spawns a Claude Code or Copilot subprocess per
  turn, costs real money, and its latency is dominated by a third-party API.
  Load-testing it measures Anthropic, not tachý.
- **Uploads and `work-items/:source/:id/fetch`** — both call third-party APIs.
- **All writes.** `POST /api/knowledge` runs another embedding and grows the
  database, so a second run would not measure the same thing as the first.

## The caveat that matters: synthetic embeddings

`npm run sync -- seed` writes **synthetic** embedding vectors by default. They
are deterministic and correctly shaped, but they are not what the real model
produces for the text beside them. The k6 query vector _is_ real, so the two
have nothing to do with each other.

Measured on a `--scale=medium` seed, for the query `printer stops mid-batch`:

```
vectors clearing SEM_FLOOR (0.6):  0 of 4000
best cosine similarity achieved:   0.1214
```

So the vector leg of hybrid search contributes **nothing**, and every result
you see came from the lexical and trigram legs. Concretely:

- **Latency is still meaningful.** The ONNX embedding still runs on the API
  event loop, and the HNSW probe still happens; the scan is bounded by
  `hnsw.max_scan_tuples`, so it does not spin. This is what the suite measures,
  and it is the real bottleneck.
- **Result counts and relevance are not meaningful.** Do not use these runs to
  judge search quality. `test/search-quality.test.ts` is what does that.

For numbers that reflect real vector search, seed with `--embed`:

```sh
docker compose -p tachy-dev run --rm cli npm run sync -- seed --scale=medium --reset --yes --embed=search
```

`--embed=search` embeds what a search reads: knowledge entries and reference
chunks. `--embed` (or `--embed=all`) adds `code_chunks`, which no scenario here
touches and which is most of the cost — measured on a 20-core workstation the
model manages roughly 33 knowledge entries, 25 reference chunks or 20 code
chunks a second, so at `--scale=large` that is about 23 minutes for `search`
against 73 for `all`. The model saturates the cores it is given; the seeder
prints an estimate before it starts and its per-phase timings after.
