# Deploy and roll back

CI builds `ghcr.io/diegokoes/tachy:sha-<commit>`, and the turn sandbox image
`sandbox-sha-<commit>`, for every push to `dev` and `main` that passed the
tests. The host only pulls.

```sh
ssh tachy@<host> tachy-deploy main          # or a commit sha
```

It resolves the commit to its image digests, refuses a schema change it cannot
apply, takes an encrypted pre-deploy backup, checks out that commit, stops the
api and the workers (the api drains running chat turns for up to 3 minutes),
recreates the stack, waits for
`/readyz` through Caddy and runs `smoke.js`. If the stack does not come up, or
readiness or smoke fails, it rolls back to the previous commit and digest by
itself and exits 1.

A release that needs a variable `.env` does not have is one Compose refuses to
start: the deploy rolls back and its output names the variable. The production
overlay requires `POSTGRES_PASSWORD`, `TACHY_APP_DB_PASSWORD`,
`TACHY_MCP_DB_PASSWORD`, `TACHY_INTERNAL_SECRET` and `TACHY_HOSTNAME`. Add what
is missing to `/opt/tachy/.env` and deploy again; the role passwords are set
from it on every deploy. `tachy-deploy` writes `TACHY_IMAGE`,
`TACHY_SANDBOX_IMAGE`, `TACHY_COMMIT` and `TACHY_DOCKER_GID` itself.

**The host's own scripts come with the release.** `tachy-deploy`,
`tachy-update`, `tachy-install`, `tachy-backup` and `tachy-watch` are
root-owned copies the playbook installs. A release that changes `deploy/host`,
`deploy/backup` or `deploy/watch` has its playbook run first, by
`tachy-deploy` itself: `sudo tachy-install host --commit <commit>`, from a
copy of the commit that root fetches from the repository. The deploy then
starts over on the scripts just installed.

- A playbook that fails refuses the deploy before anything of the release
  started. The log records `refused` with `host step failed`, and
  `tachy-update` does not try that commit again.
- A playbook that changes Docker's settings restarts Docker, and the running
  release with it, before the new one is rolled.
- A rollback does not take the scripts back. `tachy-deploy <previous commit>`
  by hand does.
- `TACHY_HOST_SYNC=off` in `/etc/tachy/tachy.env` leaves the playbook to a
  person: the deploy goes on, says which command to run, and `sudo
tachy-install status` lists the host scripts as differing until it is.
- A host set up before `tachy-install` has no `/etc/tachy/host-release`; a
  deploy there says so and leaves the scripts alone.

A rollback does not undo a schema change. The database keeps the new schema
and the stamp goes back to the previous release's, so that release reports
ready and keeps serving. The next deploy finds nothing left to apply and
stamps again. After a plan applied with `--allow-destructive` the stamp stays:
the previous release is then not ready, on purpose, and the way back is the
pre-deploy backup.

The smoke run logs in as `SMOKE_EMAIL` from `/etc/tachy/tachy.env`: a member
account, no team, marked as a service account. It only reads, and passes on a
database with no content. Without that account the deploy refuses to start;
`--skip-smoke` deploys anyway and the log records `"smoke": "skipped"`.

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

**Turn sandboxes off** (DEPLOYMENT-ARCHITECTURE.md §5.17), while a sandbox
problem is fixed: `TACHY_TURN_SANDBOX=off` in `/opt/tachy/.env`, then
`sudo systemctl restart tachy`. Claude Code runs in the api and the workers
again, and so do an organization's hooks. Remove the line once it is fixed.

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
