# Contributing

tachý is a solo project right now. There's no team, no backlog of "good first
issues," and no expectation that anyone else will show up. This file exists
anyway, in case someone does.

## Reporting a bug or suggesting something

Open a [GitHub issue](https://github.com/diegokoes/tachy/issues). Include what
you ran, what you expected, and what actually happened.

## Pull requests

- Branch off `main`, keep the diff focused on one thing.
- Run `npm run typecheck && npm test` before opening it. CI runs the same two
  commands and won't merge if they fail.
- tachý is AGPL-3.0-or-later; your contribution will be licensed the same way
  once merged.

## Commit messages

This repo follows [Conventional Commits](https://www.conventionalcommits.org/):
`type(scope): subject`, where `type` is one of `feat`, `fix`, `docs`, `test`,
`refactor`, `ci`, `chore`. Scope is optional: use it when a change is clearly
about one package (`feat(core): ...`), skip it otherwise. There's no changelog
tool reading these yet, but a readable `git log` is its own reward.

## A note on AI-assisted contributions

If you used an AI tool for a meaningful part of a contribution, mention it in the PR description. The bar isn't "did you use autocomplete," it's "can you explain what this code does and why it's correct." If you can't, I probably can't review it either.

## Security

Found something sensitive? See [SECURITY.md](SECURITY.md). Please don't open a
public issue for it.

## Code of conduct

Be respectful in issues and PRs. That's the whole code of conduct for now.
