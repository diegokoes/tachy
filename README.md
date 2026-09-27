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

Postgres initializes from `db/schema.sql`, so clone the repo first. The stack
builds locally; the published image is private.

```bash
git clone https://github.com/diegokoes/tachy.git
cd tachy
cp .env.example .env      # set TACHY_SECRET_KEY and TACHY_SESSION_SECRET
docker compose up -d --build
curl localhost:8787/readyz
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

Production runs on one host with `docker-compose.yml` plus
`deploy/compose.prod.yml`: Caddy is the only published service (TLS on 443),
the api connects to Postgres as the least-privilege `tachy_app` role, and every
container has memory, CPU and process limits. The dev stack deploys the same
way on its own machine, with `TACHY_ENV_BADGE=dev`.

- **Build once.** GitHub Actions runs `typecheck`, `web:check` and `coverage`
  on every pull request and push to `dev` and `main`, then pushes
  `ghcr.io/diegokoes/tachy:sha-<commit>`. Hosts never build.
- **Deploy.** `ssh tachy@<host> tachy-deploy <commit|branch>` pins the image
  digest, checks out the same commit, takes an encrypted backup, drains running
  chat turns, waits for `/readyz`, runs `load/smoke.js`, and rolls itself back
  on failure. A changed `db/schema.sql` is applied as a diff
  ([pg-schema-diff](https://github.com/stripe/pg-schema-diff)); a plan that
  would lose data needs `--allow-destructive`.
- **Host.** `deploy/host/playbook.yml` (Ansible) sets up users, SSH, the
  firewall, Docker, read-only SFTP for backup downloads, and the systemd timers
  for `tachy-backup` (encrypted dumps every 6 hours, a weekly restore test) and
  `tachy-watch` (alerts in Teams, a healthchecks.io heartbeat).
- **Backups** leave the host only as age ciphertext, pulled to laptops by
  `deploy/backup/Get-TachyBackup.ps1`.

Procedures are in [deploy/runbooks](deploy/runbooks/README.md); the reasoning is
in [DEPLOYMENT-ARCHITECTURE.md](DEPLOYMENT-ARCHITECTURE.md).

A redeploy drains chat turns for up to three minutes before stopping the api.
Logins survive it when `TACHY_SESSION_SECRET` is set, and past chats resume
from the agent-home volume. Restoring vault credentials needs the original
`TACHY_SECRET_KEY`, so keep the `.env` secrets in a password manager.

There is deliberately no migrations directory. See
[CONTRIBUTING.md](CONTRIBUTING.md) and
[deploy/runbooks/schema-change.md](deploy/runbooks/schema-change.md).

## License

AGPL-3.0-or-later, see [LICENSE](LICENSE). Contributions:
[CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).
