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
