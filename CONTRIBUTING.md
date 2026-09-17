# Contributing

tachý is a solo project right now. There's no team, no backlog of "good first
issues," and no expectation that anyone else will show up. This file exists
anyway, in case someone does.

## Reporting a bug or suggesting something

Open a [GitHub issue](https://github.com/diegokoes/tachy/issues). Include what
you ran, what you expected, and what actually happened.

## Branches

`dev` is the integration branch and `main` is what production runs. Work
branches off `dev`, and pull requests target `dev`. `main` only ever receives a
merge from `dev`, and production is deployed from it. See the table in
[README.md](README.md#deployment).

There are no version tags and no releases. Only the latest commit on `main` is
supported, which is what [SECURITY.md](SECURITY.md) says too.

## Pull requests

- Branch off `dev`, target `dev`, keep the diff focused on one thing.
- Run `npm run typecheck && npm run web:check && npm run coverage` before
  opening it. GitHub Actions runs the same three on every pull request and on
  pushes to `dev` and `main`, so a failure blocks the merge. `coverage` rather
  than `test` because that is what applies the thresholds.
- tachý is AGPL-3.0-or-later; your contribution will be licensed the same way
  once merged.

## Database schema changes

`db/schema.sql` is the single source of truth. Edit it directly; the test setup
applies it on every run, and `test/schema-drift.test.ts` checks its CHECK
constraints against the core enums, so drift fails CI.

`db/roles.sql` holds the least-privilege roles (`tachy_app` for the API and MCP
children, `tachy_backup` for dumps) and their grants. It is idempotent and runs
after `schema.sql`, so a new table needs no grant of its own: re-applying
`roles.sql` covers it.

There is deliberately no migrations directory. The previous one held three files
that were already fully mirrored in `schema.sql`, no-ops on a fresh database,
while re-running them silently rewrote `analysis_runs.mode` for every `create` /
`code` / `chat` row, because the normalizing `UPDATE` predated the widened CHECK
beside it. There was no applied-migrations table, so every run re-applied every
file.

Upgrading an existing deployment is a declarative diff instead:
[pg-schema-diff](https://github.com/stripe/pg-schema-diff) compares the live
database with `db/schema.sql` and applies the difference, and `tachy-deploy`
runs it from the new image. A pull request that changes `schema.sql` gets a
`schema-plan` CI job (`scripts/schema-plan.sh`): the base branch's schema and
fixtures are migrated to yours, a second plan must be empty, and a fresh
database from your schema must plan empty too. Hazards that can lose data or
change behaviour (`deploy/postgres/schema-hazards.sh`) fail the job unless the
pull request carries the `schema-destructive` label, and then need
`tachy-deploy --allow-destructive`.

What a diff cannot see still needs care:

- A rename looks like a drop plus an add. Ship it as expand and contract: add
  the new column, backfill, move the code, drop the old one in a later release.
- A release should run against the previous release's schema too, so it can be
  rolled back without a restore.
- Changing the embedding model or vector dimension still needs
  `npm run sync reembed`, since vectors from two models share no space.

## Commit messages

This repo follows [Conventional Commits](https://www.conventionalcommits.org/):
`type(scope): subject`, where `type` is one of `feat`, `fix`, `docs`, `test`,
`refactor`, `ci`, `chore`. Scope is optional: use it when a change is clearly
about one package (`feat(core): ...`), skip it otherwise. There's no changelog
tool reading these yet, but a readable `git log` is its own reward.

## A note on AI-assisted contributions

If you used an AI tool for a meaningful part of a contribution, mention it in
the PR description. The bar is: can you explain what this code does and why it's
correct? If you can't, I probably can't review it either.

## Security

Found something sensitive? See [SECURITY.md](SECURITY.md). Please don't open a
public issue for it.

## Code of conduct

Be respectful in issues and PRs. That's the whole code of conduct for now.
