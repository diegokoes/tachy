<h1 align="center">tachý</h1>

<p align="center">
  <em>A self-hosted, source-agnostic knowledge engine for work items.</em>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg" alt="License: AGPL-3.0-or-later"></a>
  <a href="https://0ver.org"><img src="https://img.shields.io/badge/0ver-0.1.0-blue.svg" alt="ZeroVer 0.1.0"></a>
  <img src="https://img.shields.io/badge/node-22%2B-brightgreen.svg" alt="Node 22+">
  <img src="https://img.shields.io/badge/postgres-14%2B-blue.svg" alt="Postgres 14+">
  <img src="https://img.shields.io/badge/protocol-MCP-orange.svg" alt="MCP">
</p>

tachý keeps an archive of lessons learned from past issues and tickets, and
you consult it. Ask for help on a new ticket and it searches that archive
first. When you solve something, archive a note about it, either tied to that
ticket or on its own. You can also just feed it context directly, like how a
codebase or product is put together, with no ticket involved at all.

It pulls tickets/issues from pluggable **sources** (Freshdesk, GitHub, more can
be added). That pulling can be manual, or scheduled through an optional REST
API/CLI instead of running it by hand every time.

tachý itself never calls an LLM. It only stores and retrieves; the agent
(Claude Code, Codex CLI, or any [MCP][mcp] client) is the reasoning layer.

<details>
<summary>Table of Contents</summary>

- [How it works](#how-it-works)
  - [Architecture](#architecture)
  - [Packages](#packages)
- [Getting started](#getting-started)
  - [Quick start with Docker](#quick-start-with-docker)
  - [Manual install](#manual-install)
- [Usage](#usage)
  - [From an MCP client (Claude Code)](#from-an-mcp-client-claude-code)
  - [MCP tools](#mcp-tools)
  - [REST API](#rest-api)
  - [CLI](#cli)
- [Concepts](#concepts)
  - [Sources](#sources)
  - [Customers, versions, and controlled vocabulary](#customers-versions-and-controlled-vocabulary)
  - [Semantic search](#semantic-search)
- [Operations](#operations)
  - [Backups](#backups)
  - [Publishing images](#publishing-images)
- [Configuration](#configuration)
- [Privacy and security](#privacy-and-security)
- [Versioning](#versioning)
- [License](#license)

</details>

## How it works

A ticket comes in. The agent reads it, works out what's going on, and (once you
approve) writes a structured lesson into tachý. The next time a *similar* ticket
appears, the agent asks tachý "have we seen anything like this?" and gets the
relevant past lessons back. Two loops, nothing more:

- **Ingest**: analyze a work item, then save an approved lesson. Nothing becomes
  knowledge until a human approves it.
- **Consult**: given a new work item, surface relevant past lessons.

### Architecture

```
   MCP client (Claude Code, Codex CLI, ...) --(MCP stdio)--> tachý MCP server ─┐
                                                                               │
   teammates / cron / CI --------------------(HTTP)--------> Hono REST API ────┼─> core ─> Postgres
                                                                               │            │
                                                          packages/sources/* <─┘            │
                                                          (Freshdesk, GitHub) ──────────────┘
```

`core` is source-agnostic and holds all the logic. `mcp`, `api`, and `cli` are
thin entrypoints that wire `core` to a way of calling it. `sources/*` are
pluggable adapters behind a single interface, so adding a source means writing
one adapter, with no schema or core changes.

### Packages

| Package | Role |
| --- | --- |
| `packages/core` | DB access, services, the `WorkItemSource` interface, local embeddings. Source-agnostic. |
| `packages/sources/freshdesk` | Freshdesk adapter (supports private-note write-back). |
| `packages/sources/github` | GitHub Issues adapter (read-only). |
| `packages/mcp` | MCP server. The primary surface. |
| `packages/api` | Hono REST API for non-MCP callers (cron, teammates, future UI). |
| `packages/cli` | Operational commands: `sync`, `embed-backfill`, `backup`, `restore`. |
| `db/schema.sql` | Canonical Postgres schema, with seed data. |

## Getting started

### Quick start with Docker

The app itself runs from the published image, no local Node needed, but you
still need `docker-compose.yml` and `db/schema.sql` from this repo (Postgres
mounts that file to initialize itself), so clone it first:

```bash
git clone https://github.com/diegokoes/tachy.git
cd tachy

cp .env.example .env
docker compose up -d
curl localhost:8787/health
```

`docker-compose.yml` uses the `pgvector/pgvector:pg16` image for Postgres
directly (it already has `pg_trgm`/`pgcrypto`, no `postgresql-contrib` needed)
and pulls the app image from `diegokoes/tachy` unless you set `TACHY_IMAGE` or
run `docker compose build` yourself.

> [!IMPORTANT]
> Set `TACHY_API_TOKEN` in `.env` before bringing the stack up. With no token,
> the API binds to `127.0.0.1` *inside the container*, which means the published
> port is unreachable from the host at all. There is no native-process loopback
> to fall back to like there is on bare metal.

### Manual install

Requires **Node 22+** (the test suite's `testcontainers` dependency needs a
webidl API only present from Node 22 on; the app itself runs fine on 20, but
22+ keeps one number to remember) and **PostgreSQL 14+** with the `vector` (pgvector),
`pg_trgm`, and `pgcrypto` extensions available (`schema.sql` creates them). The
easiest way to get pgvector locally is the `pgvector/pgvector` Docker image, or
`apt install postgresql-16-pgvector`. On a plain Debian/Ubuntu apt repo (rather
than apt.postgresql.org) `pg_trgm`/`pgcrypto` may live in a separate
`postgresql-contrib` package; add it if `create extension` fails.

```bash
npm install

createdb tachy
psql "postgres://localhost:5432/tachy" -f db/schema.sql

cp .env.example .env          # then fill in DATABASE_URL and your token(s)
```

> Freshdesk numeric `status` (e.g. 6) is account-specific and stored raw.

## Usage

### From an MCP client (Claude Code)

`.mcp.json` already registers the server for Claude Code, and `.vscode/mcp.json`
does the same for VS Code Copilot. Both auto-discover from the project folder,
so no setup is needed for either. Other MCP clients (Codex CLI, etc.) register
servers in their own global config; the command to point them at is the same
one in those two files: `npx tsx packages/mcp/src/index.ts` from this folder
(or the Dockerized form a few sections up).

From the project folder, start your client (e.g. `claude`) and talk to it in
plain language:

```
analyze ticket 58925 from acme-freshdesk
```

The agent calls `fetch_work_item`, cleans and summarizes, shows you the summary,
and only calls `save_knowledge_entry` after you approve. To consult:

```
what do we know that's relevant to ticket 61010?
```

The agent calls `get_context` (fetch + search) and answers. Optionally:

```
post that analysis as a private note on 61010
```

To run the MCP server in Docker (no local Node at all), point your MCP config at
`docker run` instead of `tsx`:

```json
{
  "mcpServers": {
    "tachy": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--env-file", ".env",
                "-e", "DATABASE_URL=postgres://tachy:tachy@postgres:5432/tachy",
                "--network", "tachy", "diegokoes/tachy", "npm", "run", "mcp"]
    }
  }
}
```

MCP just needs stdin/stdout kept open (`-i`); `--network tachy` lets this
short-lived container reach the `postgres` service from `docker-compose.yml` by
name, which is why `DATABASE_URL` is overridden here: `.env`'s default points
at `localhost`, which inside this container would mean itself, not Postgres.
Adjust the user/password if you changed `POSTGRES_USER`/`POSTGRES_PASSWORD`.

### MCP tools

**Core loop:** `fetch_work_item`, `search_knowledge`, `get_context`,
`save_knowledge_entry`, `post_private_note`, `add_knowledge_feedback`,
`record_analysis_run`.

`search_knowledge` and `get_context` are hybrid: keyword (FTS + trigram) blended
with semantic similarity over a local embedding, so paraphrases surface even
with no shared keywords. `save_knowledge_entry` stamps `created_by` from
`TACHY_USER_EMAIL`, embeds the entry on save, and is **customer-blind**:
identity never enters the searchable text or the embedding.

**Curated vocabulary** (so the agent never invents categories from a ticket
alone): `list_resolution_patterns` / `add_resolution_pattern`,
`list_components` / `add_component`, `list_customers` / `add_customer`, plus the
corrections `set_work_item_customer` and `set_observed_version`.

### REST API

Optional, for cron jobs, teammates, or a future UI.

```bash
npm run api          # http://localhost:8787
```

`GET /health`, `POST /work-items/:source/:id/fetch`, `GET /knowledge/search?q=`,
`POST /knowledge`, `GET /knowledge/:id/feedback`, `POST /knowledge/:id/feedback`,
`POST /analysis-runs`, `POST /work-items/:source/:id/notes`,
`PATCH /work-items/:id/customer`, `PATCH /work-items/:id/observed-version`,
`GET|POST /resolution-patterns`, `GET|POST /products/:slug/components`,
`GET|POST /customers`.

Set `TACHY_API_TOKEN` to require a bearer token on every route except `/health`
(`Authorization: Bearer <token>`). If unset, the server binds to `127.0.0.1`
only and warns. The MCP server (stdio) is unaffected.

### CLI

```bash
npm run sync sync acme-freshdesk --since=2026-06-01T00:00:00Z --group=48000641379
npm run sync embed-backfill     # embed entries that don't have a vector yet
npm run sync backup             # pg_dump -Fc into ./backups/
npm run sync restore --file=backups/tachy-….dump   # pg_restore (overwrites!)
```

`sync` only stores/refreshes raw work items; it never creates knowledge entries
(those always require your approval). With Docker, use the `cli` service, which
isn't started by `up`:

```bash
docker compose run --rm cli npm run sync acme-freshdesk
docker compose run --rm cli npm run sync backup     # lands in ./backups on the host
```

## Concepts

### Sources

A source is anything that produces work items, behind a single interface
(`WorkItemSource` in `packages/core/src/source.ts`). To add one, implement the
interface, register it in the entrypoints, and insert a `source_connections`
row. No schema change.

| | `external_id` | Routing | Write-back | Token env var |
| --- | --- | --- | --- | --- |
| Freshdesk | ticket number | `group_id` maps to a product | private notes | `FRESHDESK_TOKEN_<SLUG>`, falling back to `FRESHDESK_TOKEN` |
| GitHub (issues) | `owner/repo#123` | `owner/repo` maps to a product, via `config.repos` or `--group`; PRs are skipped | not supported (GitHub comments are public, so `post_private_note` is refused) | `GITHUB_TOKEN_<SLUG>`, falling back to `GITHUB_TOKEN` |

### Customers, versions, and controlled vocabulary

`knowledge_entries` is customer-blind by design. Identity never enters search or
the embedding, so retrieval matches on the fault, not on who reported it.
Customer and version are properties of the *ticket*, not the *lesson*:

- `work_items.customer_id` is auto-matched at ingest by the requester's email
  domain against `customers.aliases` (handles distributors/resellers fronting
  for the same account, e.g. an alias list of `davidoff.com` + `arvato.com` on
  one `customers` row). Wrong or missing matches are corrected with
  `set_work_item_customer`; corrections are never overwritten by a later
  re-sync. `customers` starts empty: add real ones with `add_customer`.
- `work_items.observed_version` is set manually with `set_observed_version`
  when a ticket states a version. It's never inferred.
- `knowledge_entries.resolution_pattern` is a **controlled vocabulary**, not
  free text: it's a foreign key into `resolution_patterns`, which starts
  **empty**. The agent must call `list_resolution_patterns` and pick an existing
  slug (or leave it unset); `add_resolution_pattern` is a separate, deliberate
  action, not something invented per-ticket. This is what makes cross-team
  pattern queries group correctly.
- `knowledge_entries.signals` (error codes, config filenames, component names)
  are promoted into a real, indexed field instead of being buried in
  `structured`, so they're searchable.
- **Components** (`list_components` / `add_component`) are a hierarchical,
  per-product architecture glossary (e.g. `business-object` with nested pools
  `configuration`, `id-issuer`, ...), fed conversationally with no ticket
  required. Two valid ways to populate it: you describe the app directly (call
  immediately), or a ticket mentions something unrecognized (the agent
  proposes, you confirm, then it's added). Never silently invented from a
  ticket.

`fetch_work_item` / `get_context` return the resolved `customer_id`,
`customer_name`, and `observed_version` alongside the ticket, so the agent can
reason about staleness/relevance narratively ("this customer is on v1.4, the
matched lesson was fixed in v1.6...") without any of it touching the search
index.

### Semantic search

Embeddings are produced by a local model (all-MiniLM-L6-v2, 384-dim, via
`fastembed`). Nothing is sent to an external API. The model (~90MB) is
downloaded on first use into `.fastembed-cache/` (the Docker image bakes it in
at build time). The `vector` column comes from `schema.sql`. Entries with a null
embedding (e.g. created before the model was available) can be backfilled:

```bash
npm run sync embed-backfill
```

## Operations

### Backups

```bash
npm run sync backup                 # pg_dump -Fc into ./backups/
npm run sync restore --file=backups/tachy-….dump   # pg_restore (overwrites!)
```

Both need the PostgreSQL client tools (`pg_dump` / `pg_restore`) on `PATH` (the
Docker image bundles a matching v16 client). `backups/` is git-ignored. Dumps
contain real ticket data, so keep them off any shared/synced folder. Schedule
`backup` with cron or Windows Task Scheduler.

### Publishing images

The image is published to two registries:

- **Docker Hub** (`diegokoes/tachy`), usually by hand:

  ```bash
  docker build -t diegokoes/tachy:latest .
  echo "$DOCKERHUB_TOKEN" | docker login -u diegokoes --password-stdin
  docker push diegokoes/tachy:latest
  ```

  The included `Jenkinsfile` automates the same thing (test, build, push
  `:latest` and `:<version>` from `package.json`) using a Jenkins
  username/password credential with ID `dockerhub-credentials`.

- **GitHub Container Registry** (`ghcr.io/<owner>/tachy`), automatically:
  `.github/workflows/publish.yml` tests, builds, and pushes on every `v*` tag
  (or a manual run). It uses the built-in `GITHUB_TOKEN`, so there's no secret
  to manage. See [Versioning](#versioning) for the tag flow.

No local registry or deploy stage: end users run the image on their own
machines.

## Configuration

Copy `.env.example` to `.env`. Secrets only ever come from the environment,
never from the database.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | all | Postgres connection string. |
| `PORT` | api | HTTP API port (default 8787). |
| `TACHY_USER_EMAIL` | core | Attributed as the author (`created_by`) of saved lessons. Optional. |
| `TACHY_API_TOKEN` | api | Bearer token for the REST API. Unset = localhost-only. |
| `FRESHDESK_TOKEN[_SLUG]` | freshdesk | Freshdesk API token (per-source or shared). |
| `GITHUB_TOKEN[_SLUG]` | github | GitHub PAT (per-source or shared). |
| `FASTEMBED_CACHE` | core | Where the embedding model is cached. Optional. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | Configure the bundled Postgres container. Keep consistent with `DATABASE_URL`. |
| `TACHY_IMAGE` | compose | Override the app image (default `diegokoes/tachy:latest`). |

## Privacy and security

Never commit real ticket data, tokens, customer names, or internal URLs. `.env`
is git-ignored; tokens are resolved from the environment by source slug, never
stored in the DB. `knowledge_entries` is customer-blind: customer identity is
kept on `work_items` and never enters the search index or embeddings.

## Versioning

tachý follows [ZeroVer][zerover] just because I find it funny: the major version is, and shall forever remain,
`0`. Breaking changes can land in any release. Pin an exact version if you depend
on it. Docker images are tagged `:latest` and `:<version>` (`:0.1.0`); a
release is a git tag matching the `package.json` version.

## License

[AGPL-3.0-or-later](LICENSE). If you run a modified version of tachý as a network
service, you must make the modified source available to its users.

[mcp]: https://modelcontextprotocol.io
[zerover]: https://0ver.org
