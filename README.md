# tachý

A self-hosted, source-agnostic knowledge engine for engineering work items.
It ingests support tickets / issues from pluggable **sources** (Freshdesk first;
GitHub and others by design), lets Claude — driven from the terminal via Claude
Code — turn them into structured, queryable "lessons learned", and retrieves
relevant prior cases when a new item comes in.

Claude is the reasoning layer. This service only persists and retrieves; it
never calls an LLM. Each item is read and structured **once**, then reused.

## Architecture

```
PowerShell -> Claude Code --(MCP stdio)--> tachy MCP server -> core -> Postgres
                                                            \-> sources/* -> Freshdesk / GitHub / ...
              teammates / cron / CI --(HTTP)--> Hono REST API -> core ----^
```

- `packages/core` — DB, the `WorkItemSource` interface, services (source-agnostic)
- `packages/sources/freshdesk` — Freshdesk adapter
- `packages/sources/github` — GitHub Issues adapter
- `packages/mcp` — MCP server for Claude Code (the primary surface)
- `packages/api` — Hono REST API (cron, teammates, future UI)
- `packages/cli` — `sync` command
- `db/schema.sql` — canonical Postgres schema

## Prerequisites

- Node 20+
- PostgreSQL 14+ with the `vector` (pgvector), `pg_trgm`, and `pgcrypto`
  extensions available; `schema.sql` creates them. The easiest way to get
  pgvector locally is the `pgvector/pgvector` Docker image, or
  `apt install postgresql-16-pgvector`.

## Setup

```bash
npm install

# Create the database and apply the schema:
createdb tachy
psql "postgres://localhost:5432/tachy" -f db/schema.sql

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

Core loop: `fetch_work_item`, `search_knowledge`, `get_context`,
`save_knowledge_entry`, `post_private_note`, `add_knowledge_feedback`,
`record_analysis_run`.

`search_knowledge` and `get_context` are hybrid: keyword (FTS + trigram) blended
with semantic similarity over a local embedding, so paraphrases surface even with
no shared keywords. `save_knowledge_entry` stamps `created_by` from
`TACHY_USER_EMAIL`, embeds the entry on save, and is **customer-blind**: identity
never enters the searchable text or the embedding (see "Customers and
versions" below).

Curated vocabulary (so Claude never invents categories from a ticket alone):
`list_resolution_patterns` / `add_resolution_pattern`,
`list_components` / `add_component`, `list_customers` / `add_customer`.
Correction: `set_work_item_customer`, `set_observed_version`.

## REST API (optional)

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
(`Authorization: Bearer <token>`). If it is unset, the server binds to
`127.0.0.1` only and warns. The MCP server (stdio) is unaffected.

## Incremental sync (optional)

```bash
npm run sync sync osapiens-freshdesk --since=2026-06-01T00:00:00Z --group=48000641379
```

Stores/refreshes raw work items only — it never creates knowledge entries
(those always require your approval). Schedule it with Windows Task Scheduler.

## Sources

Two adapters ship today:

- **Freshdesk** — `external_id` is the ticket number; `group_id` maps to a
  product. Supports private-note write-back.
- **GitHub** (issues) — `external_id` is `owner/repo#123`; `owner/repo` maps to a
  product. Set the repos to sync in the connection's `config.repos`
  (`["owner/repo", ...]`) or pass `--group=owner/repo`. PRs are skipped. GitHub
  has no private notes, so `post_private_note` is intentionally refused.

Tokens follow one pattern: `FRESHDESK_TOKEN_<SLUG>` / `GITHUB_TOKEN_<SLUG>`,
falling back to `FRESHDESK_TOKEN` / `GITHUB_TOKEN`.

### Adding another source

Implement `WorkItemSource` (see `packages/core/src/source.ts`), register it in
the entrypoints, and add a `source_connections` row. No schema change.

## Customers, versions, and controlled vocabulary

`knowledge_entries` is customer-blind by design — identity never enters search
or the embedding, so retrieval matches on the fault, not on who reported it.
Customer and version are properties of the *ticket*, not the *lesson*:

- `work_items.customer_id` is auto-matched at ingest by the requester's email
  domain against `customers.aliases` (handles distributors/resellers fronting
  for the same account, e.g. an alias list of `davidoff.com` + `arvato.com` on
  one `customers` row). Wrong or missing matches are corrected with
  `set_work_item_customer`; corrections are never overwritten by a later
  re-sync. `customers` starts empty — add real ones with `add_customer`.
- `work_items.observed_version` is set manually with `set_observed_version`
  when a ticket actually mentions a version — never inferred.
- `knowledge_entries.resolution_pattern` is a **controlled vocabulary**, not
  free text — it's a foreign key into `resolution_patterns`, which starts
  **empty**. Claude must call `list_resolution_patterns` and pick an existing
  slug (or leave it unset); `add_resolution_pattern` is a separate, deliberate
  action, not something invented per-ticket. This is what makes cross-team
  pattern queries actually group correctly.
- **Components** (`list_components` / `add_component`) are a hierarchical,
  per-product architecture glossary (e.g. `business-object` with nested pools
  `configuration`, `id-issuer`, ...) — fed conversationally, with no ticket
  required. Two valid ways to populate it: you describe the app directly (call
  immediately), or a ticket mentions something unrecognized (Claude proposes,
  you confirm, then it's added) — never silently invented from a ticket.

`fetch_work_item` / `get_context` return the resolved `customer_id`,
`customer_name`, and `observed_version` alongside the ticket, so Claude can
reason about staleness/relevance narratively ("this customer is on v1.4, the
matched lesson was fixed in v1.6...") without any of it touching the search
index.

## Semantic search

Embeddings are produced by a local model (all-MiniLM-L6-v2, 384-dim, via
`fastembed`) — nothing is sent to an external API. The model (~90MB) is
downloaded on first use into `.fastembed-cache/`. Fresh databases get the
`vector` column from `schema.sql`; to upgrade an existing database run
`db/0002_pgvector.sql` (and `db/0003_customer_signals_patterns_components.sql`
if upgrading from before customers/signals/resolution_patterns/components)
then backfill embeddings for prior entries:

```bash
npm run sync embed-backfill
```

## Backups

```bash
npm run sync backup                 # pg_dump -Fc into ./backups/
npm run sync restore --file=backups/tachy-….dump   # pg_restore (overwrites!)
```

Both need the PostgreSQL client tools (`pg_dump` / `pg_restore`) on `PATH`.
`backups/` is git-ignored — dumps contain real ticket data, so keep them off any
shared/synced folder. Schedule `backup` with Windows Task Scheduler.

## Privacy

Never commit real ticket data, tokens, customer names, or internal URLs.
`.env` is git-ignored; tokens are resolved from env by source slug, never stored
in the DB.

## License

AGPL-3.0-or-later. If you run a modified version of tachy as a network
service, you must make the modified source available to its users (see
`LICENSE`).
