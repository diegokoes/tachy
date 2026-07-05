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

tachý keeps an archive of lessons learned from past tickets and issues, and you
consult it. Ask for help on a new ticket and it searches that archive first.
When you solve something, save a note about it, tied to that ticket or on its
own. You can also feed it context directly, like how a codebase or product is
put together, with no ticket involved.

It pulls work items from pluggable **sources** (Freshdesk, GitHub, more can be
added). Pulling is manual, or scheduled through the optional REST API and CLI.

tachý never calls an LLM itself. It stores and retrieves; the agent (Claude
Code, Codex CLI, or any [MCP][mcp] client) is the reasoning layer. The one
exception is the optional server-side agent behind the web Chat, which uses the
Claude Agent SDK.

> **Looking for internals?** Architecture, the data model, the source interface,
> search internals, authentication, the agent, and the redaction design live in
> the [wiki](../../wiki).

<details>
<summary>Table of Contents</summary>

- [Features](#features)
- [How it works](#how-it-works)
- [Getting started](#getting-started)
  - [Quick start with Docker](#quick-start-with-docker)
  - [Manual install](#manual-install)
- [Usage](#usage)
  - [From an MCP client](#from-an-mcp-client)
  - [MCP tools](#mcp-tools)
  - [Web UI and agent](#web-ui-and-agent)
  - [REST API](#rest-api)
  - [Authentication](#authentication)
  - [CLI](#cli)
- [Configuration](#configuration)
- [Operations](#operations)
- [Privacy and security](#privacy-and-security)
- [Versioning](#versioning)
- [License](#license)

</details>

## Features

- **Knowledge archive** of approved lessons from tickets and issues, searched
  automatically when a similar work item comes in. Nothing becomes knowledge
  until a human approves it.
- **Knowledge lifecycle.** Mark a lesson outdated (`deprecated`) instead of
  deleting it: it stays searchable but flagged, optionally pointing at the entry
  that supersedes it. Issues resurface; lessons should not vanish.
- **Consistent taxonomy.** Entries anchor to a per-product component glossary
  (with aliases and hierarchy), so the agent cannot invent competing names for
  the same area. New areas are proposed to you, never created silently.
- **Freeform context.** Feed in a codebase or product overview with no ticket
  involved, stored as reference docs.
- **Pluggable sources** (Freshdesk, GitHub Issues; more fit behind one
  interface), pulled manually or on a schedule.
- **MCP server** for local agents: Claude Code, VS Code Copilot, Codex CLI, or
  any MCP client. It is vendor-neutral; drive it with your own model if you want.
- **Web UI** to search and curate knowledge, plus a **Chat** backed by a
  server-side agent, with human approval before anything is written.
- **Hybrid search** (keyword plus semantic) with **fully local embeddings**.
  Nothing leaves the machine.
- **Customer-blind index.** Retrieval matches on the fault, not on who reported
  it.
- **Optional PII and secret redaction.** Scrub customer personal data,
  credentials, and card numbers before any model sees them. Per connection, or
  forced on for the whole deployment with one env var. Off by default.
- **Flexible auth.** Setup wizard with password login, shared bearer token, or
  OIDC/Entra SSO. Admin and member roles.
- **Backups** via `pg_dump` and `pg_restore`, plus published Docker images.

## How it works

A ticket comes in. The agent reads it, works out what is going on, and once you
approve, writes a structured lesson into tachý. Next time a *similar* ticket
appears, the agent asks tachý "have we seen anything like this?" and gets the
relevant past lessons back. Two loops around work items, plus a third way in
that skips the ticket entirely:

- **Ingest.** Analyze a work item, then save an approved lesson.
- **Consult.** Given a new work item, surface relevant past lessons.
- **Load context.** Feed in freeform material (a codebase overview, a runbook, an
  architecture note) with no work item at all. It is stored as reference docs,
  embedded, and searched alongside the lessons during consult.

For architecture, packages, and data-model design, see the [wiki](../../wiki).

## Getting started

### Quick start with Docker

The app runs from the published image, no local Node needed, but you still need
`docker-compose.yml` and `db/schema.sql` from this repo (Postgres mounts that
file to initialize itself), so clone it first:

```bash
git clone https://github.com/diegokoes/tachy.git
cd tachy

cp .env.example .env
docker compose up -d
curl localhost:8787/health
```

Compose runs Postgres from `pgvector/pgvector:pg16` (extensions already
included) and pulls the app image from `diegokoes/tachy`. Override with
`TACHY_IMAGE`, or build your own with `docker compose build`.

On first boot with an empty database, open the web UI and the one-time
[setup wizard](#authentication) creates the admin account. Until an admin
exists (and with no token or SSO configured), the server binds to `127.0.0.1`
inside the container, so run the wizard locally first, or set `TACHY_API_TOKEN`
before bringing the stack up.

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

## Usage

### From an MCP client

tachý exposes 35 tools over the [Model Context Protocol][mcp]. Any MCP-capable
host can drive them. `.mcp.json` (Claude Code) and `.vscode/mcp.json` (VS Code
Copilot) auto-register the server from the project folder, no setup. Other
clients (Codex CLI, and so on) use their own config; point them at
`npx tsx packages/mcp/src/index.ts` from this folder, or the Docker form below.

From the project folder, start your client (for example `claude`) and talk to it
in plain language:

```
analyze ticket 58925 from acme-freshdesk
```

The agent calls `fetch_work_item`, cleans and summarizes, shows you the summary,
and only calls `save_knowledge_entry` after you approve. To consult:

```
what do we know that's relevant to ticket 61010?
```

The agent calls `get_context` (fetch plus search) and answers. Optionally:

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
service by name (hence the `DATABASE_URL` override, since `.env`'s `localhost`
would mean the container itself).

### MCP tools

**Core loop:** `fetch_work_item`, `search_knowledge`, `get_context`,
`save_knowledge_entry`, `post_private_note`, `add_knowledge_feedback`,
`record_analysis_run`.

**Curation:** `update_knowledge_entry` patches entries and drives the lifecycle:
deprecate an outdated lesson (optionally linking its replacement) or archive it
out of search entirely.

**Curated vocabulary** (so the agent never invents categories from a ticket
alone): `list_resolution_patterns` / `add_resolution_pattern`, `list_components`
/ `add_component` (components also anchor each entry's product area),
`list_environments`, `list_customers` / `add_customer`, `list_labels` /
`add_label`, plus the corrections `set_work_item_customer` and
`set_observed_version`.

**Reference docs** (freeform project context): `ingest_context`,
`save_reference_doc`, `search_reference`, `list_reference_docs` /
`get_reference_doc` / `update_reference_doc`.

**Admin / org structure:** `list_teams` / `add_team`, `list_products` /
`add_product`, `list_source_connections` / `add_source_connection`,
`list_source_product_maps` / `add_source_product_map`.

Search is hybrid (keyword plus semantic) and the knowledge index is
customer-blind. See the [wiki](../../wiki) for the full tool reference and how
that works.

### Web UI and agent

```bash
npm run web:build    # build the SPA into packages/web/dist
npm run api          # serves the SPA + API at http://localhost:8787
# frontend dev with hot reload: npm run web:dev  (proxies /api to :8787)
```

The Svelte SPA (`packages/web`) is served by the same Hono process: one origin,
no CORS. It has read/curate views (Knowledge search, browse and detail with
feedback; Reference docs; Admin) plus a **Chat** that drives the server-side
agent.

The agent authenticates with `ANTHROPIC_API_KEY` (or the server's Claude Code
login if unset) and is restricted to the tachý MCP tools only; it cannot touch
the filesystem or shell. Read tools auto-run; write tools are held for a human
approval in the Chat UI before they execute.

### REST API

All data routes are under `/api` (the SPA and API share one origin):
`GET /health`, `GET /auth/config`, `GET /api/setup/status`, `POST /api/setup`,
`POST /api/work-items/:source/:id/fetch`, `GET /api/knowledge/search?q=`,
`GET|POST /api/knowledge`, `GET|PATCH /api/knowledge/:id`,
`GET|POST /api/knowledge/:id/feedback`, `GET /api/reference`,
`GET /api/reference/search`, `GET /api/reference/:id`, `POST /api/agent/chat`
(SSE), `POST /api/agent/approve`, `POST /api/agent/uploads`,
`GET|POST /api/users`, `PATCH /api/users/:id`, `GET /api/system`,
`PUT /api/settings/:key`, `GET|POST /api/resolution-patterns`,
`GET|POST /api/products/:slug/components`, `GET|POST /api/customers`,
`GET|POST /api/teams`, `GET|POST /api/products`.

Request bodies are validated (zod); bad input, missing resources, and version
conflicts return `400` / `404` / `409` rather than a generic `500`.

### Authentication

Three ways in, freely combined; the bearer token always works for automation.

- **Setup wizard plus password login.** On first boot with an empty database the
  web UI runs a one-time wizard: it creates the admin account (email plus
  password, scrypt-hashed) and the runtime settings. From then on, interactive
  users sign in with email and password (session cookie signed with
  `TACHY_SESSION_SECRET`; if unset, an ephemeral secret is generated and sessions
  reset on restart). More users are managed in **Admin › Users**.
- **`token`.** Set `TACHY_API_TOKEN`; a shared bearer guards `/api/*`
  (automation, scripts, CI). Treated as admin.
- **`sso`.** Set `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` (plus
  `TACHY_SESSION_SECRET`) for Microsoft Entra or any OIDC provider. Coexists with
  password login; the login screen offers both.
- **`open`** (nothing configured, wizard skipped). No auth, binds to `127.0.0.1`
  only. Laptop dev.

**Roles.** Each user is `admin` or `member`. Admins manage users, org structure,
and settings; members use the app (reads plus agent). Mutations under the admin
API return `403` for members. The bearer token and open mode act as admin. Users
link to teams via team membership (Admin › Users).

`/health`, the SPA shell, and `/api/setup/status` stay public; `/api/*` requires
a session or the bearer. The first-boot wizard endpoint (`POST /api/setup`)
disables itself permanently once an admin exists.

### CLI

```bash
npm run sync sync acme-freshdesk --since=2026-06-01T00:00:00Z --group=48000641379
npm run sync embed-backfill     # embed entries that don't have a vector yet
npm run sync migrate            # apply db/migrations/*.sql (idempotent, safe to re-run)
npm run sync backup             # pg_dump -Fc into ./backups/
npm run sync restore --file=backups/tachy-….dump   # pg_restore (overwrites!)
```

`migrate` upgrades an **existing** database to the current schema. Fresh installs
do not need it: Docker's initdb applies `db/schema.sql` (always the full, current
schema), but only on an empty data dir, so upgrades of a running deployment go
through `migrate`.

`sync` only stores and refreshes raw work items; it never creates knowledge
entries (those always require your approval). With Docker, use the `cli` service,
which is not started by `up`:

```bash
docker compose run --rm cli npm run sync acme-freshdesk
docker compose run --rm cli npm run sync backup     # lands in ./backups on the host
```

## Configuration

Copy `.env.example` to `.env`. Secrets only ever come from the environment, never
from the database. Non-secret **runtime settings** (PII redaction, agent
model/effort/allowlist, org name) live in the database: set them in the setup
wizard or **Admin › System**. The matching env vars below act as *fallback
defaults* until a DB value is set (the System tab shows which source wins).

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | all | Postgres connection string. |
| `PORT` | api | HTTP API port (default 8787). |
| `TACHY_USER_EMAIL` | core | Attribution for the standalone MCP server (`created_by`). Optional; web/SSO users are attributed from their login. |
| `TACHY_API_TOKEN` | api | Bearer token for the REST API and automation. |
| `TACHY_AUTH_MODE` | api | `sso` \| `token` \| `open`. Optional; auto-derived from what is set. |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | api | Microsoft Entra (or any OIDC) SSO. Enables interactive login. |
| `OIDC_REDIRECT_URI` / `OIDC_SCOPES` | api | OIDC redirect (register in Entra) and scopes. Optional. |
| `TACHY_SESSION_SECRET` | api | Session-cookie signing secret (32+ chars). Signs SSO and password-login sessions; unset means an ephemeral secret (sessions reset on restart). |
| `ANTHROPIC_API_KEY` | agent | Auth for the server-side agent. If unset, the server's Claude Code login is used. |
| `TACHY_REDACT` | core | *Fallback default* for the DB setting `redaction_global`. `true` forces PII and secret redaction on for **every** connection and for connection-less tools (`ingest_context`, retrieved search results). The deployment-wide compliance switch. |
| `TACHY_AGENT_MODEL` | agent | *Fallback default* for `agent_model` (default `claude-sonnet-5`). |
| `TACHY_AGENT_EFFORT` | agent | *Fallback default* for `agent_effort`: `low` \| `medium` \| `high` \| `xhigh` \| `max` (default `medium`). |
| `TACHY_ALLOWED_MODELS` | agent | *Fallback default* for `allowed_models` (comma-separated; empty means no restriction). |
| `TACHY_UPLOAD_DIR` | api | Where Chat uploads are staged for the agent. Optional (OS tmp). |
| `FRESHDESK_TOKEN[_SLUG]` | freshdesk | Freshdesk API token (per-source or shared). |
| `GITHUB_TOKEN[_SLUG]` | github | GitHub PAT (per-source or shared). |
| `FASTEMBED_CACHE` | core | Where the embedding model is cached. Optional. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | Configure the bundled Postgres container. Keep consistent with `DATABASE_URL`. |
| `TACHY_IMAGE` | compose | Override the app image (default `diegokoes/tachy:latest`). |

**PII and secret redaction** is off by default and enabled per source connection
(`config` = `{"redaction": {"enabled": true}}` on the `source_connections` row),
or for the whole deployment with `TACHY_REDACT=true` (or the `redaction_global`
setting). Use the deployment-wide switch when company policy forbids sending
customer personal data or credentials to any LLM. Only the LLM-facing copies are
scrubbed; the database keeps full data on your own infrastructure. See the
[wiki](../../wiki) for exactly what gets scrubbed.

## Operations

### Backups

```bash
npm run sync backup                 # pg_dump -Fc into ./backups/
npm run sync restore --file=backups/tachy-….dump   # pg_restore (overwrites!)
```

Both need the PostgreSQL client tools (`pg_dump` / `pg_restore`) on `PATH` (the
Docker image bundles a matching v16 client). `backups/` is git-ignored. Dumps
contain real ticket data, so keep them off any shared or synced folder. Schedule
`backup` with cron or Windows Task Scheduler.

### Publishing images

Published to two registries:

- **Docker Hub** (`diegokoes/tachy`), by hand (the included `Jenkinsfile`
  automates the same: test, build, push `:latest` plus `:<version>`):

  ```bash
  docker build -t diegokoes/tachy:latest .
  echo "$DOCKERHUB_TOKEN" | docker login -u diegokoes --password-stdin
  docker push diegokoes/tachy:latest
  ```

- **GHCR** (`ghcr.io/<owner>/tachy`), automatically via
  `.github/workflows/publish.yml` on every `v*` tag (built-in `GITHUB_TOKEN`, no
  secret to manage). See [Versioning](#versioning) for the tag flow.

End users run the image on their own machines, no deploy stage.

## Privacy and security

Never commit real ticket data, tokens, customer names, or internal URLs. `.env`
is git-ignored; tokens resolve from the environment by source slug, never stored
in the DB. The knowledge index is customer-blind, the server-side agent is locked
to the tachý tools only, and customer PII can optionally be redacted before it
reaches any model. Full details are in the [wiki](../../wiki).

## Versioning

tachý follows [ZeroVer][zerover] just because I find it funny: the major version
is, and shall forever remain, `0`. Breaking changes can land in any release. Pin
an exact version if you depend on it. Docker images are tagged `:latest` and
`:<version>` (`:0.1.0`); a release is a git tag matching the `package.json`
version.

## License

[AGPL-3.0-or-later](LICENSE). If you run a modified version of tachý as a network
service, you must make the modified source available to its users.

[mcp]: https://modelcontextprotocol.io
[zerover]: https://0ver.org
