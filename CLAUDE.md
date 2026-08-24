# tachy — contributor notes

Instructions for working **on** this repo. The instructions the tachy agent runs
**with** live in [`packages/agent/prompt.md`](packages/agent/prompt.md) — see below.

## Layout

Folders are named for the domain they own, never `utils` / `helpers` / `common`.

| Package              | Owns                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/contract`  | What the browser and the server must agree on: vocabularies, grade bands, credential and export-naming rules. No dependencies, ever — it is bundled into the SPA         |
| `packages/core`      | Everything with logic: `knowledge`, `reference`, `search`, `work-items`, `code`, `catalog`, `access`, `config`, `compliance`, `exports`, `analytics`, `sources`, `infra` |
| `packages/sources/*` | One connector each: `freshdesk`, `github`, `azure-devops`                                                                                                                |
| `packages/mcp`       | The MCP server — every tool the agent can call                                                                                                                           |
| `packages/agent`     | Backends (`claude.ts`, `copilot.ts`), turn plumbing, and `prompt.md`                                                                                                     |
| `packages/api`       | HTTP routes, auth, slash-command expansion                                                                                                                               |
| `packages/web`       | Svelte SPA                                                                                                                                                               |
| `packages/cli`       | `npm run sync` — backup/restore, indexing                                                                                                                                |

## Commands

```sh
npm run typecheck && npm run web:check && npm test    # what CI runs
npm run api                      # server on :8787
npm run web:dev                  # SPA dev server
npm run format                   # prettier
```

Tests need Docker (testcontainers spins up Postgres).

## The agent prompt is a per-request cost

`packages/agent/prompt.md` is appended to the system prompt of **every** agent
turn, on both backends. Adding a paragraph there is a bill paid on every message
the product ever sends, so it holds only what shapes reasoning _before_ a tool
call: identity, invariants, mode playbooks.

Anything about how to call one tool correctly belongs to that tool instead —
its MCP `description`, a Zod `.describe()` on the field, or a `next:` / `note:`
on the result it returns. That travels with the tool and is paid for on the turn
that needs it. `withCompaction`, `NO_MATCHES` and `unresolvedCustomer` in
`packages/mcp/src/index.ts` are the pattern to copy.

## Conventions

- **No AI-written inline comments.** Comment only where the _why_ is genuinely
  non-obvious, in prose a maintainer would have written. Terse JSDoc at most.
- **`db/schema.sql` is the source of truth** — edit it directly. There is no
  migrations directory, deliberately; see CONTRIBUTING.md.
- **Credentials** live in the encrypted vault (`TACHY_SECRET_KEY`). The MCP
  subprocess env is built fresh per turn and must never be pooled across users.
- **The SPA imports `@tachy/contract`, never `@tachy/core`.** Core opens
  Postgres on import. A rule both sides enforce — a vocabulary, a validation, a
  naming convention — belongs in the contract, and core re-exports it so server
  code still reaches it through `@tachy/core`. Copying it into `packages/web`
  instead is how the admin panel and the vault came to disagree about what a
  valid Anthropic key looks like.

See [CONTRIBUTING.md](CONTRIBUTING.md) for PRs, schema changes and licensing.
