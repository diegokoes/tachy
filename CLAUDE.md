# tachy — contributor notes

Instructions for working **on** this repo. The instructions the tachy agent runs
**with** live in [`packages/agent/prompt.md`](packages/agent/prompt.md) — see below.

## Layout

Folders are named for the domain they own, never `utils` / `helpers` / `common`.

| Package              | Owns                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contract`  | What the browser and the server must agree on: vocabularies, grade bands, credential and export-naming rules. No dependencies, ever — it is bundled into the SPA                                    |
| `packages/core`      | Everything with logic: `knowledge`, `reference`, `wiki`, `library`, `search`, `work-items`, `code`, `catalog`, `access`, `config`, `compliance`, `exports`, `analytics`, `sources`, `jobs`, `infra` |
| `packages/sources/*` | One connector each: `freshdesk`, `github`, `azure-devops`                                                                                                                                           |
| `packages/mcp`       | The MCP server — every tool the agent can call                                                                                                                                                      |
| `packages/agent`     | Backends (`claude.ts`, `copilot.ts`), turn plumbing, and `prompt.md`                                                                                                                                |
| `packages/api`       | HTTP routes, auth, slash-command expansion                                                                                                                                                          |
| `packages/web`       | Svelte SPA                                                                                                                                                                                          |
| `packages/worker`    | The job worker service: works runs of the job kinds core defines                                                                                                                                    |
| `packages/cli`       | `npm run sync` — backup/restore, indexing                                                                                                                                                           |

## Commands

```sh
npm run typecheck && npm run web:check && npm run coverage   # what CI runs
npm run api                      # server on :8787
npm run web:dev                  # SPA dev server
npm test                         # the suite without the coverage ratchet
npm run format                   # prettier
```

Tests need Docker (testcontainers spins up Postgres).

## The agent prompt is a per-request cost

`packages/agent/prompt.md` is the system prompt of **every** agent turn: the
whole of it on Claude, appended to the runtime's own on Copilot. Adding a paragraph there is a bill paid on every message
the product ever sends, so it holds only what shapes reasoning _before_ a tool
call: identity, invariants, mode playbooks.

Anything about how to call one tool correctly belongs to that tool instead —
its MCP `description`, a Zod `.describe()` on the field, or a `next:` / `note:`
on the result it returns. That travels with the tool and is paid for on the turn
that needs it. `withCompaction` and `unresolvedCustomer` in
`packages/mcp/src/context.ts`, and `NO_MATCHES` in `packages/mcp/src/results.ts`,
are the pattern to copy.

Nothing else reaches the agent. `claudeOptions` and `copilotSessionConfig` in
`packages/agent/src` pin what each backend reads: no settings, CLAUDE.md or
`.mcp.json` on Claude, and an empty working directory on Copilot, whose runtime
otherwise loads this file and any `AGENTS.md` into the prompt. Their tests fail
if either starts reading from disk again.

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
