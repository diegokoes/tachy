# tachý — Technical Documentation

Internal design and data-model reference for tachý. The [README](README.md)
covers features, installation, deployment, and usage; this document covers *how
and why* it is built the way it is.

## Contents

- [Architecture](#architecture)
- [Packages](#packages)
- [Data model & design rationale](#data-model--design-rationale)
  - [Customer-blind knowledge entries](#customer-blind-knowledge-entries)
  - [Controlled vocabulary](#controlled-vocabulary)
  - [Promoted facets & signals](#promoted-facets--signals)
  - [Customers & versions](#customers--versions)
- [Sources](#sources)
- [Hybrid & semantic search](#hybrid--semantic-search)
- [Server-side agent](#server-side-agent)
- [Compliance & PII redaction](#compliance--pii-redaction)
- [Model, effort & cost policy](#model-effort--cost-policy)
- [Security model](#security-model)

## Architecture

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

The stack is **LLM-agnostic at its core.** `packages/mcp` exposes the tools over
the [Model Context Protocol][mcp] and `packages/core` is pure domain logic +
Postgres — no LLM provider is hardcoded on this path. Any MCP-capable host
(Claude Code, another vendor's client, or an organization's *own* model) can
drive the tools. The only Claude-specific component is the optional bundled
[server-side agent](#server-side-agent).

Two loops, nothing more:

- **Ingest**: analyze a work item, then save an approved lesson. Nothing becomes
  knowledge until a human approves it.
- **Consult**: given a new work item, surface relevant past lessons.

## Packages

| Package | Role |
| --- | --- |
| `packages/core` | All logic, organized by domain: `knowledge`, `reference`, `work-items`, `catalog`, `sources`, `search`, `compliance`, `platform`. Source-agnostic. |
| `packages/sources/freshdesk` | Freshdesk adapter (supports private-note write-back). |
| `packages/sources/github` | GitHub Issues adapter (read-only). |
| `packages/mcp` | MCP server. The primary surface for local agents (Claude Code, Copilot). |
| `packages/agent` | Server-side reasoning: drives the Claude Agent SDK against the MCP server so the deployed app can reason (structure docs, consult tickets) without a local agent. |
| `packages/api` | Hono REST API + SSE agent endpoints; also serves the web UI. |
| `packages/web` | Svelte SPA: search/curate knowledge and a Chat that talks to the agent. |
| `packages/cli` | Operational commands: `sync`, `embed-backfill`, `backup`, `restore`. |
| `db/schema.sql` | Canonical Postgres schema, with seed data. There are no incremental migrations — the schema is applied wholesale. |

## Data model & design rationale

### Customer-blind knowledge entries

`knowledge_entries` is customer-blind by design. Identity never enters search or
the embedding, so retrieval matches on the *fault*, not on who reported it.
`save_knowledge_entry` stamps `created_by` from `TACHY_USER_EMAIL`, embeds the
entry on save, and keeps customer identity out of both the searchable text and
the vector. Customer and version are properties of the *ticket* (`work_items`),
not the *lesson*.

### Controlled vocabulary

`knowledge_entries.resolution_pattern` is a **controlled vocabulary** (a FK into
`resolution_patterns`, which starts empty), not free text: the agent picks an
existing slug or leaves it unset; `add_resolution_pattern` is a deliberate,
separate action. This is what makes cross-team pattern queries group correctly.

**Components** (`list_components` / `add_component`) are a hierarchical,
per-product architecture glossary, fed conversationally — either you describe the
app directly, or the agent proposes one from a ticket and you confirm. Never
silently invented. Naming variants are handled with `aliases` on one entry, not
duplicate entries.

### Promoted facets & signals

`knowledge_entries.signals` (error codes, config filenames, component names) are
promoted into a real, indexed field instead of being buried in `structured`, so
they're searchable by trigram (a future search for `023` or `TOO_MANY_STRINGS`
matches). The facets `cloud`, `resolution_clarity`, `learning_value`, and
`hidden_fix` are likewise real, indexed columns (promote what you filter on), so
"all `prod` issues" or "high `learning_value` lessons to review" are queries.
Everything else stays in the free-form `structured` JSONB, which is validated on
save but never filtered.

### Customers & versions

- `work_items.customer_id` is auto-matched at ingest by the requester's email
  domain against `customers.aliases` (so distributors/resellers fronting for one
  account map together). Fix a wrong/missing match with `set_work_item_customer`;
  corrections survive re-sync. `customers` starts empty (`add_customer`).
- `work_items.observed_version` is set manually with `set_observed_version` when a
  ticket states one. Never inferred.

`fetch_work_item` / `get_context` return the resolved `customer_id`,
`customer_name`, and `observed_version` alongside the ticket, so the agent can
reason about staleness narratively ("this customer is on v1.4, the lesson was
fixed in v1.6…") without any of it touching the search index.

## Sources

A source is anything that produces work items, behind a single interface
(`WorkItemSource` in `packages/core/src/sources/source.ts`). To add one, implement
the interface, register it in the entrypoints, and insert a `source_connections`
row. No schema change.

| | `external_id` | Routing | Write-back | Token env var |
| --- | --- | --- | --- | --- |
| Freshdesk | ticket number | `group_id` maps to a product | private notes | `FRESHDESK_TOKEN_<SLUG>`, falling back to `FRESHDESK_TOKEN` |
| GitHub (issues) | `owner/repo#123` | `owner/repo` maps to a product, via `config.repos` or `--group`; PRs are skipped | not supported (GitHub comments are public, so `post_private_note` is refused) | `GITHUB_TOKEN_<SLUG>`, falling back to `GITHUB_TOKEN` |

`source_connections.config` is a free-form JSONB bag for non-secret,
per-connection settings (e.g. GitHub's `{"repos": [...]}`, or the
[redaction](#compliance--pii-redaction) switch). Tokens are never stored there —
they are resolved from the environment by source slug.

Freshdesk numeric `status` (e.g. 6) is account-specific and stored raw.

## Hybrid & semantic search

`search_knowledge` and `get_context` are hybrid: keyword (Postgres FTS + `pg_trgm`
trigram) blended with semantic similarity over a local embedding, so paraphrases
surface even with no shared keywords.

Embeddings come from a local model (all-MiniLM-L6-v2, 384-dim, via `fastembed`) —
nothing leaves the machine. The ~90MB model downloads on first use into
`.fastembed-cache/` (baked into the Docker image). Backfill null embeddings (e.g.
entries created before the model was available) with `npm run sync embed-backfill`.

## Server-side agent

The agent (`packages/agent`) is the deployed app's reasoning layer — it runs the
Claude Agent SDK against the existing tachý MCP server, with `CLAUDE.md` as its
system prompt. It authenticates with `ANTHROPIC_API_KEY`, or the Claude Code login
on the server if that's unset.

It is a thin wrapper: the only LLM-vendor coupling in the whole project lives in
`packages/agent/src/index.ts` (one import of `@anthropic-ai/claude-agent-sdk`),
consumed only by `packages/api/src/routes/agent.ts`. Everything else is
provider-neutral.

**Security is enforced by a hard tool allowlist** (see [Security model](#security-model)).

## Compliance & PII redaction

An **optional, per-connection** layer lets a deployment satisfy company AI-usage
policies that forbid sending customer personal data to a model. It is **off by
default** — with nothing configured, behavior is byte-for-byte unchanged.

**Principle — redact at the MCP boundary.** Redaction happens inside the
`fetch_work_item` / `get_context` tool handlers, *before any model sees the data*.
Because that boundary is provider-neutral, the same protection covers Claude, an
organization's own LLM, or any future consumer. The redaction runs **after**
`ingestWorkItem` (the full-data DB write) and `resolveCustomerByEmail` (email-domain
matching), so storage keeps the real data and customer auto-matching still works —
only the copy returned to the model is scrubbed.

**Toggle (no schema change).** Set it on the source connection's existing
`config` JSONB:

```jsonc
// source_connections.config
{ "redaction": { "enabled": true } }   // absent / false → no redaction
```

A Freshdesk tenant ≈ one company, so per-connection is the natural granularity.

**Two layers** (`packages/core/src/compliance/redaction.ts`):

1. **Source-agnostic** — scrubs the normalized `RawWorkItem` fields every adapter
   produces identically: `requesterEmail` dropped, `requester` replaced with the
   resolved **customer slug**, `title` and each `messages[].bodyText` run through
   a regex scrub (emails → `[EMAIL_n]`, phone numbers → `[PHONE_n]`), message
   authors → `[USER_n]`. Tokens are **stable per work item** (the same value maps
   to the same token), so referential context survives.
2. **Source-specific** — each adapter implements an optional `redactRaw()` hook on
   `WorkItemSource` to scrub the source-specific `raw` payload, since only the
   adapter knows its field shape. Both layers share one token map.

| Source | `raw` fields scrubbed |
| --- | --- |
| Freshdesk | `email`, `phone`, `name`; `cc_emails` / `to_emails` / `fwd_emails` / `reply_cc_emails`; `twitter_id` / `facebook_id`; the `requester` embed (`email`/`mobile`/`phone`/`name`); `company.name`; free-text `subject` / `description` / `description_text`; and the **values** of `custom_fields` (keys such as `cf_devops_work_item` are preserved). |
| GitHub | actor `login` / `email` / `name` on `user` / `assignee` / `assignees` / `closed_by`; free-text `title` / `body`. |

**The "names are useful" workaround.** Because the app already resolves the
requester's email domain to a known `customers` row, the model is shown the stable
customer **slug** (e.g. `acme-corp`) in place of the person's real name/email —
the *company* signal is preserved, the *individual* PII is dropped.

**Scope of the regex approach.** Redaction is deterministic (structured fields +
email/phone regex); it does not run named-entity recognition, so a person's name
typed free-form in a message body is only caught if it appears as an email/phone.
All structured PII fields and all emails/phones are covered.

Note: Freshdesk conversation entries already only expose `body_text` into the
normalized messages — per-message `from_email` / `to_emails` / `cc_emails` /
`bcc_emails` / `support_email` are dropped by the adapter mapping and never reach a
model regardless of redaction mode.

## Model, effort & cost policy

Applies **only** to the bundled Claude agent (`packages/agent` +
`packages/api/src/routes/agent.ts`); it adds no coupling to the MCP/core path, so
an organization driving the tools with its own model is unaffected.

- **Default model** is `claude-sonnet-5` (per the "use Sonnet by default" cost
  guidance), overridable with `TACHY_AGENT_MODEL`.
- **`TACHY_ALLOWED_MODELS`** (comma-separated) is an optional allowlist: a
  disallowed or unset model is clamped to the first entry. Empty = no restriction.
- **`TACHY_AGENT_EFFORT`** sets the reasoning-effort level (`low` … `max`, default
  `medium`).
- **Cost surfacing** — `recordRun` computes an estimated USD cost from the run's
  model + token counts (per the published per-MTok tiers) into
  `analysis_runs.meta.estimated_cost_usd`. Audit only; no enforcement.

## Security model

- **Secrets from the environment only.** Tokens are resolved from env by source
  slug and never stored in the database. `.env` is git-ignored.
- **Customer-blind index.** Customer identity is kept on `work_items` and never
  enters the search index or embeddings (see
  [above](#customer-blind-knowledge-entries)).
- **Agent tool allowlist.** The server-side agent gets *only* the tachý MCP tools —
  every built-in file/bash/web tool is disabled, so it can't touch the filesystem
  or shell and never prompts to "edit a file." Read/consult tools auto-run; write
  tools (`save_*`, `update_*`, `add_*`, `post_private_note`) are held for a human
  approval in the Chat UI before they execute.
- **Optional PII redaction** before data reaches a model — see
  [Compliance & PII redaction](#compliance--pii-redaction).
- **Never commit real ticket data**, tokens, customer names, or internal URLs.
  Database dumps contain real ticket data; keep them off any shared/synced folder.

[mcp]: https://modelcontextprotocol.io
