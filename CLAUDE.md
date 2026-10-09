# tachy - contributor notes

Instructions for working **on** this repo. The instructions the tachy agent runs
**with** live in [`packages/agent/prompt.md`](packages/agent/prompt.md) - see below.

## Layout

Folders are named for the domain they own, never `utils` / `helpers` / `common`.

| Package              | Owns                                                                                                                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contract`  | What the browser and the server must agree on: vocabularies, grade bands, credential and export-naming rules. No dependencies, ever - it is bundled into the SPA                                                                                                                    |
| `packages/core`      | Everything with logic: `knowledge`, `reference`, `wiki`, `library`, `search`, `work-items`, `code`, `catalog`, `buckets`, `flows`, `chat`, `reports`, `notifications`, `access`, `audit`, `config`, `compliance`, `exports`, `analytics`, `sources`, `jobs`, `diagnostics`, `infra` |
| `packages/sources/*` | One connector each: `freshdesk`, `github`, `azure-devops`                                                                                                                                                                                                                           |
| `packages/mcp`       | The MCP server - every tool the agent can call                                                                                                                                                                                                                                      |
| `packages/agent`     | The Claude backend (`claude.ts`), turn plumbing, `prompt.md`, and the one-shot review prompts                                                                                                                                                                                       |
| `packages/api`       | HTTP routes, auth, slash-command expansion                                                                                                                                                                                                                                          |
| `packages/web`       | Svelte SPA                                                                                                                                                                                                                                                                          |
| `packages/worker`    | The job worker service: works runs of the job kinds core defines                                                                                                                                                                                                                    |
| `packages/cli`       | `npm run sync` - backup/restore, indexing                                                                                                                                                                                                                                           |

A concept keeps the name core gives it in every layer: `core/src/wiki`,
`mcp/src/tools/wiki.ts`, `api/src/routes/wiki.ts`, `web/src/wiki`, `test/wiki`.
Server code imports a domain from its subpath, `@tachy/core/wiki`, so a file's
imports say which domains it depends on; `@tachy/core` itself is only the
contract, re-exported.

In the SPA a domain's folder holds its views, its admin panels and its row
types; `admin/` only mounts those panels. `tui`, `shell`, `motion`, `markdown`,
`keys` and `theme` are what the domains share.

## Commands

```sh
npm run typecheck && npm run web:check && npm run coverage   # what CI runs
npm run api                      # server on :8787
npm run web:dev                  # SPA dev server
npm test                         # the suite without the coverage ratchet
npm run format                   # prettier
npm run comments:check           # the comment rules under Conventions
```

Tests need Docker (testcontainers spins up Postgres).

Coverage floors are per package, in `vitest.config.ts`. New code ships with
tests that run it: `scripts/coverage-diff.ts` fails a pull request under 80% of
added lines. Raise a package's floor when its coverage rises; never lower one.

## The agent prompt is a per-request cost

`packages/agent/prompt.md` is the whole system prompt of **every** agent turn.
Adding a paragraph there is a bill paid on every message the product ever sends, so it holds only what shapes reasoning _before_ a tool
call: identity, invariants, mode playbooks.

Anything about how to call one tool correctly belongs to that tool instead -
its MCP `description`, a Zod `.describe()` on the field, or a `next:` / `note:`
on the result it returns. That travels with the tool and is paid for on the turn
that needs it. `withCompaction` and `unresolvedCustomer` in
`packages/mcp/src/context.ts`, and `NO_MATCHES` in `packages/mcp/src/results.ts`,
are the pattern to copy.

Nothing else reaches the agent. `claudeOptions` in `packages/agent/src` pins
what the backend reads: no settings, CLAUDE.md or `.mcp.json`. Its tests fail
if it starts reading from disk again.

## Conventions

- **A comment states what the code cannot**: a reason, a constraint, an
  external fact, or a contract detail the signature lacks (unit, range, order,
  what null means). Present tense; no history, incidents, measured numbers or
  emphasis. At most 3 lines in a body, 5 on a declaration, 12 for one file
  header. `/** */` on declarations, `//` in bodies, `/* */` in CSS only.
  `npm run comments:check` holds the mechanical part.
- **A name carries what a comment would.** Length follows lifetime: one letter
  only for a loop index, a one-expression callback or a fixed idiom (`c`, `tx`,
  `e`). A collection is named for its contents, a bare number carries its unit
  (`timeoutMs`), a threshold is a named constant, a verb keeps one meaning.
- **Flow**: guard clauses first, no nested ternaries, no positional booleans in
  a new signature. A block that needs a label becomes a named function.
- **`db/schema.sql` is the source of truth** - edit it directly. There is no
  migrations directory, deliberately; see CONTRIBUTING.md.
- **Credentials** live in the encrypted vault (`TACHY_SECRET_KEY`). The MCP
  subprocess env is built fresh per turn and must never be pooled across users.
- **The SPA imports `@tachy/contract`, never `@tachy/core`.** Core opens
  Postgres on import. A rule both sides enforce - a vocabulary, a validation, a
  naming convention - belongs in the contract, and core re-exports it so server
  code still reaches it through `@tachy/core`. Copying it into `packages/web`
  instead is how the admin panel and the vault came to disagree about what a
  valid Anthropic key looks like.

See [CONTRIBUTING.md](CONTRIBUTING.md) for PRs, schema changes and licensing.
