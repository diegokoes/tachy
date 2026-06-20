# casebook

A self-hosted, source-agnostic knowledge engine for engineering work items.
It ingests support tickets / issues from pluggable **sources** (Freshdesk first;
GitHub and others by design), lets Claude — driven from the terminal via Claude
Code — turn them into structured, queryable "lessons learned", and retrieves
relevant prior cases when a new item comes in.

Claude is the reasoning layer. This service only persists and retrieves; it
never calls an LLM. Each item is read and structured **once**, then reused.

## Architecture

```
PowerShell -> Claude Code --(MCP stdio)--> casebook MCP server -> core -> Postgres
                                                            \-> sources/* -> Freshdesk / GitHub / ...
              teammates / cron / CI --(HTTP)--> Hono REST API -> core ----^
```

- `packages/core` — DB, the `WorkItemSource` interface, services (source-agnostic)
- `packages/sources/freshdesk` — Freshdesk adapter
- `packages/mcp` — MCP server for Claude Code (the primary surface)
- `packages/api` — Hono REST API (cron, teammates, future UI)
- `packages/cli` — `sync` command
- `db/schema.sql` — canonical Postgres schema

## Prerequisites

- Node 20+
- PostgreSQL 14+ (extensions `pg_trgm` and `pgcrypto`; `schema.sql` creates them)

## Setup

```bash
npm install

# Create the database and apply the schema:
createdb casebook
psql "postgres://localhost:5432/casebook" -f db/schema.sql

cp .env.example .env          # then fill in DATABASE_URL and your Freshdesk token
```

`schema.sql` seeds the teams/products you use (Track & Trace -> tpd, ftrace;
BPT -> csdr, eudr, pcf, medical-devices), the `osapiens-freshdesk` source, and
an example group mapping (Freshdesk group `48000641379` -> tpd). Adjust the
seed block for your other groups.

> Freshdesk numeric `status` (e.g. 6) is account-specific and stored raw.

## Use it from Claude Code (PowerShell)

`.mcp.json` already registers the server. From the project folder:

```powershell
claude
```

Then, in the session:

```
analyze ticket 58925 from osapiens-freshdesk
```

Claude will call `fetch_work_item`, clean + summarize, show you the summary,
and only call `save_knowledge_entry` after you approve. To consult:

```
what do we know that's relevant to ticket 61010?
```

Claude calls `get_context` (fetch + archive search) and answers. Optionally:

```
post that analysis as a private note on 61010
```

### MCP tools

`fetch_work_item`, `search_knowledge`, `get_context`, `save_knowledge_entry`,
`post_private_note`.

## REST API (optional)

```bash
npm run api          # http://localhost:8787
```

`GET /health`, `POST /work-items/:source/:id/fetch`, `GET /knowledge/search?q=`,
`POST /knowledge`, `POST /work-items/:source/:id/notes`.

## Incremental sync (optional)

```bash
npm run sync sync osapiens-freshdesk --since=2026-06-01T00:00:00Z --group=48000641379
```

Stores/refreshes raw work items only — it never creates knowledge entries
(those always require your approval). Schedule it with Windows Task Scheduler.

## Adding a source

Implement `WorkItemSource` (see `packages/core/src/source.ts`), register it in
the entrypoints, and add a `source_connections` row. No schema change.

## Privacy

Never commit real ticket data, tokens, customer names, or internal URLs.
`.env` is git-ignored; tokens are resolved from env by source slug, never stored
in the DB.

## License

MIT.
