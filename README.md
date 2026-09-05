<h1 align="center">tachý</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg" alt="License: AGPL-3.0-or-later"></a>
  <a href="https://0ver.org"><img src="https://img.shields.io/badge/0ver-0.1.0-blue.svg" alt="ZeroVer 0.1.0"></a>
  <img src="https://img.shields.io/badge/node-24.18%2B-brightgreen.svg" alt="Node 24.18+">
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
  linked Azure items (Freshdesk custom fields / `AB#123` mentions) fetched and
  attached to the analysis, not merely noticed.
- **Projects** — each Azure DevOps project, Freshdesk group or GitHub repo is
  registered as a project: bound to a product (with its wiki, its repos and
  area-path→component rules), or kept productless as a place to raise and
  reassign work items. Team admins configure their own.
- **Azure DevOps extras** — read wiki pages into reference docs, and create
  work items with per-project required fields discovered from ADO's own
  schema, nothing hardcoded.
- **Code consultation** — link git repos to the component each implements,
  index them into local embeddings, and the agent searches/reads bounded
  snippets (`search_code`, `read_code_file`) — narrowed to the relevant repo —
  instead of burning tokens on whole files.
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

Node 24.18+ and PostgreSQL 14+ with `vector`, `pg_trgm`, `pgcrypto`
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

**Claude authentication — two rails.** Each turn spawns a `claude` subprocess
carrying the calling user's own credential and a per-user state directory under
`TACHY_AGENT_HOME` (default `~/.claude`), so users never share a login or each
other's session transcripts. Either credential works, and the most specific
scope wins (user › team › global › env); an API key wins an exact tie.

| Credential                                       | Get it with                                                               | Billed to                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Claude subscription token** (`sk-ant-oat01-…`) | `claude setup-token` on your own machine, then paste into Settings › Keys | that account's own subscription; bounded by its usage limits |
| **Anthropic API key** (`sk-ant-api03-…`)         | console.anthropic.com                                                     | the organisation's API billing                               |

Nothing observable distinguishes a personal-account token from a work-seat one,
so tell people to approve with their work account — the app cannot check it.

`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` in the server's own
environment is the `env` rung: the lowest one. It answers for users who have
added nothing of their own and never overrides a credential they did add, which
makes it the way to keep an existing deployment working while people onboard.
The server's own `claude login` no longer answers anyone's turn — each user
gets their own state directory, so a user with no credential anywhere sees
"add your Claude token in Settings › Keys" rather than silently borrowing the
server's account.

Subscription seats are bounded by usage limits rather than spend. A turn costs
what its input costs, and every turn carries the agent prompt
(`packages/agent/prompt.md`), so limits arrive sooner than interactive-chat
intuition suggests — keeping that file short is the cheapest lever if users
start hitting them. It holds only what shapes reasoning before a tool is
called; anything about how to call one tool belongs in that tool's MCP
description, which ships with the tool instead of with every turn.

**Sources.** Freshdesk (tickets, private notes), GitHub Issues, Azure DevOps
work items (multi-project; relations, linked PRs/commits, wikis, and
schema-checked ticket creation). Register connections in Admin › Org › sources
— domain/organization plus the API key or PAT, stored encrypted — then hit
`test` to list the groups/projects that token can see. Connections and their
tokens are org-wide, so they stay global-admin territory. The Azure client
targets REST API **7.1** — the released version; everything in 7.2 is still
preview.

**Projects.** Admin › Org › projects is where a team admin says what each
source-native grouping actually is. A **knowledge** project maps to a product:
its items ingest there, it carries the project wiki, its repos, and rules
mapping Azure DevOps area paths to components, so an incoming item lands on the
right component instead of being guessed at. A **tracker** project has no
product — it is a place work items get raised and reassigned, and nothing is
filed under it. A coverage list flags what is still unwired: discovered but
unregistered projects, missing wikis, repos with no component, failing indexes.

**Code search.** Link git repos in Admin › Org › repos (or `PUT /api/repos`) —
pick the project, the component the repo implements, and the branch; clone URLs
are discovered from Azure DevOps. Index from the same screen
(`POST /api/repos/:slug/reindex` or the CLI) and the agent gets `search_code` /
`read_code_file` over local embeddings, narrowable to a component so a question
about the portal searches the portal's repo. Clones live under `TACHY_REPO_DIR`
(Docker: a named volume).

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

This is how people sign in to tachý. How a chat turn then authenticates to
Claude is separate — see **Claude authentication** under [Usage](#usage).

## CLI

```bash
npm run sync sync acme-freshdesk --since=2026-06-01T00:00:00Z
npm run sync embed-backfill                       # embed entries missing a vector
npm run sync index-repo <repo-slug>               # clone/fetch + (re)index code
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

| Variable                                                    | Purpose                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                                              | Postgres connection string.                                          |
| `PORT`                                                      | HTTP port (default 8787).                                            |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`       | Bundled Postgres container; keep consistent with `DATABASE_URL`.     |
| `TACHY_SECRET_KEY`                                          | Vault master key (32 bytes base64). Unset = vault disabled.          |
| `TACHY_SESSION_SECRET`                                      | Session-cookie signing (32+ chars). Unset = logins reset on restart. |
| `TACHY_API_TOKEN`                                           | Bearer for REST automation. Optional.                                |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`     | OIDC SSO. Optional.                                                  |
| `TACHY_IMAGE`                                               | Compose image override (default `diegokoes/tachy:latest`).           |
| `TACHY_REPO_DIR` / `TACHY_UPLOAD_DIR` / `TACHY_MODEL_CACHE` | Data paths; sensible defaults, Docker image sets them.               |
| `TACHY_AGENT_HOME`                                          | Root for per-user Claude Code state (default `~/.claude`).           |
| `CLAUDE_CODE_OAUTH_TOKEN`                                   | Fallback Claude subscription token when the vault holds none.        |

PII/secret redaction is off by default: per connection
(`{"redaction":{"enabled":true}}` in the connection config) or deployment-wide
via the `redaction_global` setting. Only LLM-facing copies are scrubbed; the
database keeps full data.

## Operations

**Deploy.** The `Jenkinsfile` tests, builds, pushes to Docker Hub, and SSHes
to the server for `docker compose pull api && up -d api` — from `main` into
`/opt/tachy`, and from `dev` into `/opt/tachy-dev`. A restart drops in-flight
chat turns; logins survive (session secret) and past chats resume (agent-home
volume). GHCR images are also published on `v*` tags via
`.github/workflows/publish.yml`.

**The dev stack.** A second compose project on the same host, for trying a
branch against a running server. `docker-compose.yml` takes its project name,
ports and image tag from the environment, so dev is just a second checkout with
its own `.env` (see `.env.dev.example`) — no override file, because Compose
appends `ports:` across `-f` files rather than replacing them. It gets its own
network, containers, volumes and database: API on `:8788`, Postgres on `:5434`.

```sh
cd /opt/tachy-dev && docker compose up -d          # .env sets COMPOSE_PROJECT_NAME
docker compose run --rm cli npm run sync -- seed --scale=medium --reset --yes
```

Because `db/schema.sql` is applied only by Postgres initdb, **resetting the dev
database is `docker compose down -v && up -d`** — that re-runs the current
schema from scratch. Then re-seed. See [load/README.md](load/README.md) for the
k6 suite that runs against it.

**Seeding.** `npm run sync -- seed [--scale=small|medium|large]` fills every
table with deterministic, plausible data: org structure, customers, work items
and messages, knowledge entries, reference docs, indexed code, and run history.
Logins are `admin@tachy.local` and `dev-member@tachy.local`, both with the
password `tachy-dev-password`. It refuses to run against a database holding
rows it did not create, and refuses outright under `NODE_ENV=production` --
which is what the compose `cli` service passes unless the stack's `.env` says
otherwise -- so it cannot eat a real deployment.

Embedding vectors are synthetic unless you pass `--embed`, which is the slow
part: `--embed=search` covers knowledge and reference (what a search reads),
and `--embed` or `--embed=all` adds code chunks, roughly tripling the time. The
seeder estimates the wait up front and prints per-phase timings after. See the
caveat in
[load/README.md](load/README.md#the-caveat-that-matters-synthetic-embeddings).

**Logs.** One JSON line per request on stderr, carrying a request id that is
also returned as the `x-request-id` header, plus the method, path, status,
duration and user. `LOG_LEVEL` (`debug|info|warn|error`, default `info`)
controls the floor; `/health` logs at `debug` so the healthcheck stays quiet.
Failed requests carry the error on the same line rather than a second one.

**Backups.** `backup` writes `pg_dump -Fc` into `./backups/` (host bind mount).
Schedule it with cron and prune old dumps:

```
0 3 * * * cd /opt/tachy && docker compose run --rm cli npm run sync backup && find backups -name '*.dump' -mtime +14 -delete
```

Dumps contain real ticket data — keep them off shared folders. Restoring vault
credentials also needs the original `TACHY_SECRET_KEY`, so keep the `.env`
secrets in a password manager.

**Upgrading past the unprivileged-user change.** The container used to run as
root; it now runs as `node` (uid 1000), and the agent-home volume moved from
`/root/.claude` to `/home/node/.claude`. Docker only chowns a volume it creates
itself, so an existing deployment has to hand over what it already wrote — once,
before starting the new image:

```sh
cd /opt/tachy && docker compose down
docker run --rm -v tachy_tachy-agent-home:/h -v tachy_tachy-repo-data:/d \
  alpine chown -R 1000:1000 /h /d
sudo chown -R 1000:1000 ./backups
docker compose up -d
```

Per-user chat state and repo clones survive; the volume names are prefixed with
the compose project (`tachy_` here, `tachy-dev_` on the dev stack — check with
`docker volume ls`). A fresh install needs none of this.

**Upgrades.** Fresh installs get the full `db/schema.sql` via Docker initdb.
Existing deployments upgrade by backing up, recreating the database from the
current `db/schema.sql`, and restoring the data tables — then `npm run sync
reembed` if the embedding model or vector dimension changed, since vectors from
two different models are not comparable.
