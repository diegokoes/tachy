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
merge from `dev`, and that merge is the deploy: Jenkins pushes an image and
restarts the production stack. See the table in
[README.md](README.md#deployment).

There are no version tags and no releases. Only the latest commit on `main` is
supported, which is what [SECURITY.md](SECURITY.md) says too.

## Pull requests

- Branch off `dev`, target `dev`, keep the diff focused on one thing.
- Run `npm run typecheck && npm run web:check && npm run coverage` before
  opening it. GitHub Actions runs the same three on every pull request and
  Jenkins runs them again before it builds an image, so a failure blocks the
  merge either way. `coverage` rather than `test` because that is what applies
  the thresholds.
- tachý is AGPL-3.0-or-later; your contribution will be licensed the same way
  once merged.

## Database schema changes

`db/schema.sql` is the single source of truth. Edit it directly; the test setup
applies it on every run, and `test/schema-drift.test.ts` checks its CHECK
constraints against the core enums, so drift fails CI.

There is deliberately no migrations directory. The previous one held three files
that were already fully mirrored in `schema.sql`, no-ops on a fresh database,
while re-running them silently rewrote `analysis_runs.mode` for every `create` /
`code` / `chat` row, because the normalizing `UPDATE` predated the widened CHECK
beside it. There was no applied-migrations table, so every run re-applied every
file.

Upgrading an existing deployment is therefore a dump, a fresh schema, and a
restore of the data tables, plus `npm run sync reembed` whenever the embedding
model or vector dimension changed, since vectors from two models share no space.
If incremental migrations come back, they need an applied-migrations table and a
test that diffs `schema.sql` against schema-plus-migrations; without both, the
two drift apart silently.

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
