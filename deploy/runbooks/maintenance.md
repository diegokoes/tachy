# Maintenance

**Draining.** Stopping the api refuses new chat turns (503, retry shortly) and
gives running ones up to `TACHY_DRAIN_SECONDS` (180) to finish; Docker waits
210 s before it would kill anything.

```sh
cd /opt/tachy && docker compose -f docker-compose.yml -f deploy/compose.prod.yml stop api
```

A turn waiting on an approval is cut at the end of the drain. Tell people in
Teams before a window that falls in working hours.

**Monthly update window** (Docker, kernel, reboot):

1. Announce it; drain as above.
2. `sudo apt update && sudo apt full-upgrade`. Docker stays on its pinned major;
   to move to the next, change `docker_major` in the inventory and rerun the
   playbook.
3. `sudo reboot`. This also tests unattended boot: LUKS unlocks by TPM2, and
   `tachy.service` starts the stack.
4. After boot: `sudo tachy-watch --dry-run` shows every check ok, and
   healthchecks.io shows fresh pings.

**Postgres image** changes only by a pinned tag bump in a release, followed by
a restore test ([upgrades.md](upgrades.md)).
