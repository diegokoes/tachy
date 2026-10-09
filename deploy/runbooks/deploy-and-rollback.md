# Deploy and roll back

CI builds `ghcr.io/diegokoes/tachy:sha-<commit>` for every push to `dev` and
`main` that passed the tests. The host only pulls.

```sh
ssh tachy@<host> tachy-deploy main          # or a commit sha
```

It resolves the commit to an image digest, refuses a schema change it cannot
apply, takes an encrypted pre-deploy backup, checks out that commit, recreates
the stack (the api drains running chat turns for up to 3 minutes), waits for
`/readyz` through Caddy and runs `smoke.js`. If readiness or smoke fails, it
rolls back to the previous commit and digest by itself and exits 1.

A rollback does not undo a schema change. The database keeps the new schema
and the stamp goes back to the previous release's, so that release reports
ready and keeps serving. The next deploy finds nothing left to apply and
stamps again. After a plan applied with `--allow-destructive` the stamp stays:
the previous release is then not ready, on purpose, and the way back is the
pre-deploy backup.

The smoke run logs in as `SMOKE_EMAIL` from `/etc/tachy/tachy.env`. Without
that account the deploy refuses to start; `--skip-smoke` deploys anyway and
the log records `"smoke": "skipped"`.

**By itself, at night.** With `TACHY_UPDATE_BRANCH=main` in
`/etc/tachy/tachy.env`, `tachy-update` runs at 01:15 and 04:45 and deploys the
branch's head when it is not what runs. Merging into that branch is the
release.

- It does nothing while CI has not published the commit's image; the next run
  tries again.
- A commit that was refused (a destructive schema plan) or rolled back is not
  tried again: tachy-watch reports `update` as failing until a newer commit
  arrives or someone deploys by hand.
- `tachy-update --check` says what it would do. `journalctl -u tachy-update`
  has the last run, and Admin › system shows its result.
- `TACHY_UPDATE_SMOKE=skip` is for a host with no smoke account yet.

**Roll back by hand:** `tachy-deploy <previous commit>`. Safe while the older
image accepts the current schema, which is what expand and contract is for.

**What happened:**

```sh
tail -5 /srv/tachy/deploy.log | jq .
```

`result` is `deployed`, `rolled_back`, `rollback_failed` or `refused`.
Admin › system shows the running commit and badge.

**`rollback_failed`:** the previous release is not ready either. Check
`docker compose logs --tail 100 api`, then restore the pre-deploy backup
([backups-and-restore.md](backups-and-restore.md)).

**The dev stack** deploys the same way from `dev`, on its own machine, with
`TACHY_ENV_BADGE=dev` in its `.env`. The same digest runs on both.
