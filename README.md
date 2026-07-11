<h1 align="center">tachý</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg" alt="License: AGPL-3.0-or-later"></a>
  <a href="https://0ver.org"><img src="https://img.shields.io/badge/0ver-0.1.0-blue.svg" alt="ZeroVer 0.1.0"></a>
  <img src="https://img.shields.io/badge/node-22%2B-brightgreen.svg" alt="Node 22+">
  <img src="https://img.shields.io/badge/postgres-14%2B-blue.svg" alt="Postgres 14+">
  <img src="https://img.shields.io/badge/protocol-MCP-orange.svg" alt="MCP">
</p>

Self-hosted knowledge engine for work items. It archives approved lessons from
past tickets/issues and searches them when a similar one comes in. It pulls
work items from pluggable sources (Freshdesk, GitHub, Azure DevOps), can index
linked git repositories for code search, and stores freeform project context as
reference docs. tachý itself only stores and retrieves — the reasoning layer is
an MCP client (Claude Code, Codex CLI, …) or the built-in web Chat agent.

Architecture, data model, source interface, search internals, and the redaction
design are in the [wiki](../../wiki).

- [Features](#features)
- [Quick start (Docker)](#quick-start-docker)
- [Manual install](#manual-install)
- [Usage](#usage)
- [Authentication](#authentication)
- [CLI](#cli)
- [Configuration](#configuration)
- [Operations](#operations)

## Features

- **Knowledge archive** of lessons from tickets/issues, searched automatically
  on similar work items. Nothing is saved without human approval.
- **Knowledge lifecycle** — deprecate outdated lessons instead of deleting;
  they stay searchable, flagged, optionally pointing at their replacement.
- **Consistent taxonomy** — entries anchor to a per-product component glossary
  (aliases, hierarchy); new areas are proposed to you, never created silently.
- **Sources**: Freshdesk (tickets, private notes), GitHub Issues, Azure DevOps
  work items — multi-project, with related items, linked PRs/commits, and
  linked-ticket detection from Freshdesk custom fields / `AB#123` mentions.
- **Azure DevOps extras** — read wiki pages into reference docs, and create
  work items with per-project required fields discovered from ADO's own
  schema, nothing hardcoded.
- **Code consultation** — link git repos, index them into local embeddings,
  and the agent searches/reads bounded snippets (`search_code`,
  `read_code_file`) instead of burning tokens on whole files.
- **Reference docs** for freeform context (runbooks, architecture notes),
  chunked and embedded, versioned with supersede lineage.
- **MCP server** (40+ tools) for Claude Code, VS Code Copilot, Codex CLI, or
  any MCP client — vendor-neutral.
- **Web UI + Chat agent** (`claude` or `copilot` backend, per user/team/global)
  with slash commands (`/analyze`, `/consult`, `/create-ticket`, `/code`,
  `/ingest-wiki`) and an approval box before any write tool runs.
- **Credential vault** — API keys and source tokens (incl. per-user ADO PATs)
  stored AES-256-GCM encrypted, scoped user > team > global.
- **Hybrid search** (keyword + trigram + semantic) with fully local
  embeddings; customer-blind index.
- **Optional PII/secret redaction** before anything reaches a model — per
  connection or deployment-wide.
- **Auth**: setup wizard + password login, bearer token, or OIDC/Entra SSO;
  admin and member roles.
- **Backups** via `pg_dump`/`pg_restore`; published Docker images.

## Quick start (Docker)

The app runs from the published image, but Postgres initializes from
`db/schema.sql` in this repo, so clone it first:

```bash
git clone https://github.com/diegokoes/tachy.git
cd tachy
cp .env.example .env      # set TACHY_SECRET_KEY and TACHY_SESSION_SECRET
docker compose up -d
curl localhost:8787/health
```

Compose runs Postgres from `pgvector/pgvector:pg16` and the app from
`diegokoes/tachy` (override with `TACHY_IMAGE`, or `docker compose build`).

On first boot with an empty database, open the web UI and the one-time setup
wizard creates the admin account. Until an admin exists (and no token/SSO is
configured), the server binds to `127.0.0.1` inside the container, run the
wizard before expecting LAN access.

## Manual install

Node 22+ and PostgreSQL 14+ with `vector`, `pg_trgm`, `pgcrypto`
(`schema.sql` creates the extensions). `git` must be on PATH for code search.

```bash
npm install
createdb tachy
psql "postgres://localhost:5432/tachy" -f db/schema.sql
cp .env.example .env
npm run web:build && npm run api    # SPA + API on :8787
```

## Usage

**From an MCP client.** `.mcp.json` (Claude Code) and `.vscode/mcp.json`
(VS Code Copilot) auto-register the server from the project folder; other
clients point at `npx tsx packages/mcp/src/index.ts`. Then talk to the agent:
`analyze ticket 58925 from acme-freshdesk`, `what do we know about ticket
61010?`.

To run the MCP server via Docker, use `docker run -i --rm --env-file .env -e
DATABASE_URL=postgres://tachy:tachy@postgres:5432/tachy --network tachy
diegokoes/tachy npm run mcp` as the MCP command.

**Web UI.** Knowledge search/curation, reference docs, admin, and a Chat that
drives the server-side agent. Chat supports slash commands (`/analyze`,
`/consult`, `/create-ticket`, `/code`, `/ingest-wiki`). Write tools pause for
an approval box showing the exact payload; the agent is restricted to tachý
MCP tools and cannot touch shell or filesystem.

**Agent backend** is per user/team/global: `claude` (Claude Agent SDK) or
`copilot` (GitHub Copilot SDK). API keys, source tokens, and Azure DevOps PATs
are stored encrypted in the app (My settings / Admin › System › credentials)
— requires `TACHY_SECRET_KEY`.

**Sources.** Freshdesk (tickets, private notes), GitHub Issues, Azure DevOps
work items (multi-project; relations, linked PRs/commits, wikis, and
schema-checked ticket creation). Register connections and group→product maps
in-app or via the MCP admin tools.

**Code search.** Link git repos (`PUT /api/repos`), index them
(`POST /api/repos/:slug/reindex` or the CLI), and the agent gets
`search_code` / `read_code_file` over local embeddings. Clones live under
`TACHY_REPO_DIR` (Docker: a named volume).

**REST API.** Everything under `/api` (zod-validated). See the wiki for the
route reference.

## Authentication

Freely combined:

- **Password login** — first-boot wizard creates the admin; users are managed
  in Admin › Users. Sessions are cookies signed with `TACHY_SESSION_SECRET`.
- **Bearer token** — `TACHY_API_TOKEN` guards `/api/*` for automation; acts as
  admin.
- **OIDC SSO** — `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`
  (+ `TACHY_SESSION_SECRET`).
- **Open** — nothing configured: no auth, binds to `127.0.0.1` only.

Roles: `admin` and `member`. Admin mutations return `403` for members.

## CLI

```bash
npm run sync sync acme-freshdesk --since=2026-06-01T00:00:00Z
npm run sync embed-backfill                       # embed entries missing a vector
npm run sync index-repo <repo-slug>               # clone/fetch + (re)index code
npm run sync migrate                              # apply db/migrations/*.sql
npm run sync backup                               # pg_dump -Fc into ./backups/
npm run sync restore -- --file=backups/tachy-….dump   # overwrites the DB
```

With Docker use the `cli` service (not started by `up`):

```bash
docker compose run --rm cli npm run sync backup
docker compose run --rm cli npm run sync index-repo line-controller
```

## Configuration

`.env` is bootstrap only. Everything else on the db.

| Variable                                                  | Purpose                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                                            | Postgres connection string.                                          |
| `PORT`                                                    | HTTP port (default 8787).                                            |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`     | Bundled Postgres container; keep consistent with `DATABASE_URL`.     |
| `TACHY_SECRET_KEY`                                        | Vault master key (32 bytes base64). Unset = vault disabled.          |
| `TACHY_SESSION_SECRET`                                    | Session-cookie signing (32+ chars). Unset = logins reset on restart. |
| `TACHY_API_TOKEN`                                         | Bearer for REST automation. Optional.                                |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`   | OIDC SSO. Optional.                                                  |
| `TACHY_IMAGE`                                             | Compose image override (default `diegokoes/tachy:latest`).           |
| `TACHY_REPO_DIR` / `TACHY_UPLOAD_DIR` / `FASTEMBED_CACHE` | Data paths; sensible defaults, Docker image sets them.               |

PII/secret redaction is off by default: per connection
(`{"redaction":{"enabled":true}}` in the connection config) or deployment-wide
via the `redaction_global` setting. Only LLM-facing copies are scrubbed; the
database keeps full data.

## Operations

**Deploy.** The `Jenkinsfile` tests, builds, pushes to Docker Hub, and (on
`main`) SSHes to the server for `docker compose pull api && up -d api`. A
restart drops in-flight chat turns; logins survive (session secret) and past
chats resume (agent-home volume). GHCR images are also published on `v*` tags
via `.github/workflows/publish.yml`.

**Backups.** `backup` writes `pg_dump -Fc` into `./backups/` (host bind mount).
Schedule it with cron and prune old dumps:

```
0 3 * * * cd /opt/tachy && docker compose run --rm cli npm run sync backup && find backups -name '*.dump' -mtime +14 -delete
```

Dumps contain real ticket data — keep them off shared folders. Restoring vault
credentials also needs the original `TACHY_SECRET_KEY`, so keep the `.env`
secrets in a password manager.

**Upgrades.** Fresh installs get the full `db/schema.sql` via Docker initdb;
running deployments apply `npm run sync migrate` (idempotent).
