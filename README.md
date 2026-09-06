<h1 align="center">tachý</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg" alt="License: AGPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/node-24.18%2B-brightgreen.svg" alt="Node 24.18+">
  <img src="https://img.shields.io/badge/postgres-14%2B-blue.svg" alt="Postgres 14+">
  <img src="https://img.shields.io/badge/protocol-MCP-orange.svg" alt="MCP">
</p>

Self-hosted knowledge engine for work items. It archives approved lessons from
past tickets and issues, then searches them when a similar one comes in. tachý
only stores and retrieves; the reasoning layer is an MCP client (Claude Code,
Codex CLI) or the built-in web chat agent.

## What it does

- Pulls work items from Freshdesk, GitHub Issues and Azure DevOps, with
  relations, linked PRs and commits fetched and attached, not merely noticed.
- Archives lessons only after a human approves them, anchored to a per-product
  component glossary. Outdated entries are deprecated rather than deleted, so
  they stay searchable and can point at their replacement.
- Indexes linked git repos into local embeddings, so the agent reads bounded
  snippets from the right repo instead of whole files.
- Stores freeform reference docs (runbooks, architecture notes), chunked,
  embedded and versioned with supersede lineage.
- Hybrid search (keyword, trigram, semantic) over a deliberately
  customer-blind index, with fully local embeddings.
- Exposes 40+ MCP tools to any MCP client, plus a Svelte web UI whose chat
  agent (`claude` or `copilot` backend) pauses for approval before any write.
- Keeps API keys and source tokens in an AES-256-GCM vault, scoped user, team,
  global.
- Password login, bearer token or OIDC SSO, and optional PII scrubbing before
  anything reaches a model.

## Install

Postgres initializes from `db/schema.sql`, so clone the repo first. There is no
published image; the stack builds locally.

```bash
git clone https://github.com/diegokoes/tachy.git
cd tachy
cp .env.example .env      # set TACHY_SECRET_KEY and TACHY_SESSION_SECRET
docker compose up -d --build
curl localhost:8787/health
```

On first boot with an empty database, open the web UI and the one-time setup
wizard creates the admin account. Until an admin exists, and with no token or
SSO configured, the server binds to `127.0.0.1` inside the container, so run the
wizard before expecting LAN access.

Without Docker you need Node 24.18+ and PostgreSQL 14+ with `vector`, `pg_trgm`
and `pgcrypto` (`schema.sql` creates the extensions), plus `git` on PATH for
code search.

```bash
npm install
createdb tachy
psql "postgres://localhost:5432/tachy" -f db/schema.sql
cp .env.example .env
npm run web:build && npm run api    # SPA + API on :8787
```

`.env` is bootstrap only, everything else is configured in the app.
`.env.example` lists and comments every variable the code reads.

MCP clients register the server from the project folder: `.mcp.json` for Claude
Code, `.vscode/mcp.json` for VS Code Copilot. Other clients point at
`npx tsx packages/mcp/src/index.ts`.

## Deployment

Two stacks on one host, both driven by `Jenkinsfile`:

| Branch | Stack      | Image tag | Path             | Ports       |
| ------ | ---------- | --------- | ---------------- | ----------- |
| `main` | production | `latest`  | `/opt/tachy`     | 8787 / 5433 |
| `dev`  | dev        | `dev`     | `/opt/tachy-dev` | 8788 / 5434 |

Every branch runs `npm ci`, `typecheck`, `web:check` and `coverage`, then builds
an image. Only `main` and `dev` push and deploy; a feature branch gets its own
`branch-*` tag that nothing pulls. Deploying is an SSH to the host followed by
`docker compose pull api && docker compose up -d api`. The dev stage first
resets its checkout to `origin/dev`, because `docker-compose.yml` is itself
versioned and has to match the image being pulled.

The two stacks share nothing. `docker-compose.yml` takes its project name, ports
and image tag from the environment, so dev is just a second checkout with its
own `.env` (see `.env.dev.example`), its own network, containers, volumes and
database. The image the servers pull is private and exists for these two stacks
only, which is why a fresh install builds instead.

A restart drops in-flight chat turns. Logins survive it when
`TACHY_SESSION_SECRET` is set, and past chats resume from the agent-home volume.

**Backups.** `docker compose run --rm cli npm run sync backup` writes a
`pg_dump -Fc` into `./backups/`. Schedule it and prune old dumps:

```
0 3 * * * cd /opt/tachy && docker compose run --rm cli npm run sync backup && find backups -name '*.dump' -mtime +14 -delete
```

Dumps hold real ticket data. Restoring vault credentials also needs the original
`TACHY_SECRET_KEY`, so keep the `.env` secrets in a password manager.

There is deliberately no migrations directory, so upgrading an existing
deployment is a backup, a fresh database from the current `db/schema.sql`, and a
restore of the data tables. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

AGPL-3.0-or-later, see [LICENSE](LICENSE). Contributions:
[CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).
