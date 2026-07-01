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
  - [Web UI and agent](#web-ui-and-agent)
  - [REST API](#rest-api)
  - [Authentication](#authentication)
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
| `packages/core` | All logic, organized by domain: `knowledge`, `reference`, `work-items`, `catalog`, `sources`, `search`, `platform`. Source-agnostic. |
| `packages/sources/freshdesk` | Freshdesk adapter (supports private-note write-back). |
| `packages/sources/github` | GitHub Issues adapter (read-only). |
| `packages/mcp` | MCP server. The primary surface for local agents (Claude Code, Copilot). |
| `packages/agent` | Server-side reasoning: drives the Claude Agent SDK against the MCP server so the deployed app can reason (structure docs, consult tickets) without a local agent. |
| `packages/api` | Hono REST API + SSE agent endpoints; also serves the web UI. |
| `packages/web` | Svelte SPA: search/curate knowledge and a Chat that talks to the agent. |
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

Compose runs Postgres from `pgvector/pgvector:pg16` (extensions already included)
and pulls the app image from `diegokoes/tachy` — override with `TACHY_IMAGE`, or
`docker compose build` your own.

> [!IMPORTANT]
> Set `TACHY_API_TOKEN` in `.env` before bringing the stack up. With no token,
> the API binds to `127.0.0.1` *inside the container*, which means the published
> port is unreachable from the host at all. There is no native-process loopback
> to fall back to like there is on bare metal.

### Manual install

Requires **Node 22+** (for the test suite) and **PostgreSQL 14+** with the
`vector` (pgvector), `pg_trgm`, and `pgcrypto` extensions (`schema.sql` creates
them). Easiest pgvector locally is the `pgvector/pgvector` Docker image or
`apt install postgresql-16-pgvector`.

```bash
npm install

createdb tachy
psql "postgres://localhost:5432/tachy" -f db/schema.sql

cp .env.example .env          # then fill in DATABASE_URL and your token(s)
```

> Freshdesk numeric `status` (e.g. 6) is account-specific and stored raw.

## Usage

### From an MCP client (Claude Code)

`.mcp.json` (Claude Code) and `.vscode/mcp.json` (VS Code Copilot) auto-register
the server from the project folder — no setup. Other clients (Codex CLI, etc.)
use their own config; point them at `npx tsx packages/mcp/src/index.ts` from this
folder (or the Docker form below).

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

To run the MCP server in Docker instead, point your MCP config at `docker run`:

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

`-i` keeps stdin/stdout open; `--network tachy` reaches the compose `postgres`
service by name (hence the `DATABASE_URL` override — `.env`'s `localhost` would
mean the container itself).

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

### Web UI and agent

```bash
npm run web:build    # build the SPA into packages/web/dist
npm run api          # serves the SPA + API at http://localhost:8787
# for frontend dev with hot reload: npm run web:dev  (proxies /api to :8787)
```

The Svelte SPA (`packages/web`) is served by the same Hono process — one origin,
no CORS. It has three read/curate views (Knowledge search/browse/detail with
feedback, Reference docs, read-only Admin) plus a **Chat** that drives the
server-side agent.

The agent (`packages/agent`) is the deployed app's reasoning layer — it runs the
Claude Agent SDK against the existing tachy MCP server, with `CLAUDE.md` as its
system prompt. It authenticates with `ANTHROPIC_API_KEY`, or the Claude Code
login on the server if that's unset. **Security is enforced by a hard tool
allowlist**: the agent gets *only* the tachy MCP tools — every built-in
file/bash/web tool is disabled, so it can't touch the filesystem or shell and
never prompts to "edit a file." Read/consult tools auto-run; write tools
(`save_*`, `update_*`, `add_*`, `post_private_note`) are held for a human
approval in the Chat UI before they execute.

### REST API

All data routes are under `/api` (the SPA and API share one origin):
`GET /health`, `GET /auth/config`, `POST /api/work-items/:source/:id/fetch`,
`GET /api/knowledge/search?q=`, `GET|POST /api/knowledge`,
`GET|PATCH /api/knowledge/:id`, `GET|POST /api/knowledge/:id/feedback`,
`GET /api/reference`, `GET /api/reference/search`, `GET /api/reference/:id`,
`POST /api/agent/chat` (SSE), `POST /api/agent/approve`, `POST /api/agent/uploads`,
`GET|POST /api/resolution-patterns`, `GET|POST /api/products/:slug/components`,
`GET|POST /api/customers`, `GET|POST /api/teams`, `GET|POST /api/products`.

Request bodies are validated (zod); bad input, missing resources, and version
conflicts return `400` / `404` / `409` rather than a generic `500`.

### Authentication

Admin-configurable, no passwords stored:

- **`open`** (default when nothing is set) — no auth, binds to `127.0.0.1` only. Laptop dev.
- **`token`** — set `TACHY_API_TOKEN`; a shared bearer guards `/api/*` (automation and the UI).
- **`sso`** — set `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` (+ `TACHY_SESSION_SECRET`) for Microsoft Entra (or any OIDC provider) single sign-on. Interactive users get a session cookie; the bearer token still works for automation.

`/health` and the SPA shell stay public; `/api/*` requires a valid session **or** the bearer. See `.env.example` for the full variable set.

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
(`WorkItemSource` in `packages/core/src/sources/source.ts`). To add one, implement
the interface, register it in the entrypoints, and insert a `source_connections`
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
  domain against `customers.aliases` (so distributors/resellers fronting for one
  account map together). Fix a wrong/missing match with `set_work_item_customer`;
  corrections survive re-sync. `customers` starts empty (`add_customer`).
- `work_items.observed_version` is set manually with `set_observed_version` when
  a ticket states one. Never inferred.
- `knowledge_entries.resolution_pattern` is a **controlled vocabulary** (a FK
  into `resolution_patterns`, which starts empty), not free text: the agent picks
  an existing slug or leaves it unset; `add_resolution_pattern` is a deliberate,
  separate action. This is what makes cross-team pattern queries group correctly.
- `knowledge_entries.signals` (error codes, config filenames, component names)
  are promoted into a real, indexed field instead of being buried in
  `structured`, so they're searchable.
- The facets `cloud`, `resolution_clarity`, `learning_value`, and `hidden_fix`
  are likewise real, indexed columns (same rationale: promote what you filter
  on), so e.g. "all `prod` issues" or "high `learning_value` lessons to review"
  are queries. Everything else stays in the free-form `structured` JSONB, which
  is validated on save but never filtered.
- **Components** (`list_components` / `add_component`) are a hierarchical,
  per-product architecture glossary, fed conversationally — either you describe
  the app directly, or the agent proposes one from a ticket and you confirm.
  Never silently invented.

`fetch_work_item` / `get_context` return the resolved `customer_id`,
`customer_name`, and `observed_version` alongside the ticket, so the agent can
reason about staleness narratively ("this customer is on v1.4, the lesson was
fixed in v1.6...") without any of it touching the search index.

### Semantic search

Embeddings come from a local model (all-MiniLM-L6-v2, 384-dim, via `fastembed`) —
nothing leaves the machine. The ~90MB model downloads on first use into
`.fastembed-cache/` (baked into the Docker image). Backfill null embeddings (e.g.
entries created before the model was available) with `npm run sync embed-backfill`.

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

Published to two registries:

- **Docker Hub** (`diegokoes/tachy`), by hand (the included `Jenkinsfile`
  automates the same — test, build, push `:latest` + `:<version>`):

  ```bash
  docker build -t diegokoes/tachy:latest .
  echo "$DOCKERHUB_TOKEN" | docker login -u diegokoes --password-stdin
  docker push diegokoes/tachy:latest
  ```

- **GHCR** (`ghcr.io/<owner>/tachy`), automatically via
  `.github/workflows/publish.yml` on every `v*` tag (built-in `GITHUB_TOKEN`, no
  secret to manage). See [Versioning](#versioning) for the tag flow.

End users run the image on their own machines — no deploy stage.

## Configuration

Copy `.env.example` to `.env`. Secrets only ever come from the environment,
never from the database.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | all | Postgres connection string. |
| `PORT` | api | HTTP API port (default 8787). |
| `TACHY_USER_EMAIL` | core | Attributed as the author (`created_by`) of saved lessons. Optional (SSO users are attributed from their login). |
| `TACHY_API_TOKEN` | api | Bearer token for the REST API / automation. Unset (and no OIDC) = localhost-only. |
| `TACHY_AUTH_MODE` | api | `sso` \| `token` \| `open`. Optional — auto-derived from what's set. |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | api | Microsoft Entra (or any OIDC) SSO. Enables interactive login. |
| `OIDC_REDIRECT_URI` / `OIDC_SCOPES` | api | OIDC redirect (register in Entra) and scopes. Optional. |
| `TACHY_SESSION_SECRET` | api | Session-cookie signing secret (≥32 chars). Required with OIDC. |
| `ANTHROPIC_API_KEY` | agent | Auth for the server-side agent. If unset, the server's Claude Code login is used. |
| `TACHY_AGENT_MODEL` | agent | Agent model (default `claude-opus-4-8`). |
| `TACHY_UPLOAD_DIR` | api | Where Chat uploads are staged for the agent. Optional (OS tmp). |
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
