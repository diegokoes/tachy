<h1 align="center">tachý</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg" alt="License: AGPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/node-24.18%2B-brightgreen.svg" alt="Node 24.18+">
  <img src="https://img.shields.io/badge/postgres-14%2B-blue.svg" alt="Postgres 14+">
  <img src="https://img.shields.io/badge/protocol-MCP-orange.svg" alt="MCP">
</p>

tachý is a self-hosted MCP server and web app on Postgres. It syncs work items
from Freshdesk, GitHub Issues and Azure DevOps together with their relations,
linked PRs and commits, indexes linked git repositories into local embeddings,
and stores versioned reference docs and lessons from resolved items. A lesson is
archived only after a human approves it, is tied to a per-product component
glossary, and is deprecated rather than deleted when superseded. Search is
hybrid (keyword, trigram, pgvector) over an index kept free of customer identity.
tachý does no reasoning itself: an MCP client (Claude Code, Codex CLI) or the
built-in chat agent (Claude or Copilot backend, approval required before any
write) calls its 40+ tools. Credentials are kept in an AES-256-GCM vault scoped
per user, team or instance; login is password, bearer token or OIDC, with
optional PII redaction before tool results reach a model.

## Install

```bash
cp .env.example .env      # set TACHY_SECRET_KEY and TACHY_SESSION_SECRET
docker compose up -d --build
```

The first visit to the web UI on `:8787` runs the setup wizard; until an admin
exists the server listens on `127.0.0.1` only. Without Docker: Node 24.18+,
PostgreSQL 14+ with `vector`, `pg_trgm` and `pgcrypto`, and `git` on PATH, then
`psql -f db/schema.sql` and `npm run web:build && npm run api`. MCP clients pick
up `.mcp.json` (Claude Code) or `.vscode/mcp.json` (VS Code); others run
`npx tsx packages/mcp/src/index.ts`.

## Deployment

Production is `docker-compose.yml` plus `deploy/compose.prod.yml` on one host,
with Caddy terminating TLS. CI builds `ghcr.io/diegokoes/tachy:sha-<commit>`,
and `ssh tachy@<host> tachy-deploy <ref>` deploys it: encrypted backup, schema
diff from `db/schema.sql`, smoke test, rollback on failure. The host is
provisioned by `deploy/host/playbook.yml`. Procedures are in
[deploy/runbooks](deploy/runbooks/README.md). Vault credentials cannot be
restored without the original `TACHY_SECRET_KEY`.

## License

AGPL-3.0-or-later, see [LICENSE](LICENSE). Contributions:
[CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).
