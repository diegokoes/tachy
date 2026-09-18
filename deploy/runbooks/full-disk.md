# A disk alert

`tachy-watch` warns at 80% and fails at 90% per mount.

```sh
df -h / /var /srv
sudo du -xsh /var/lib/* /srv/* 2>/dev/null | sort -h | tail
docker system df
```

**`/var` (12 GB).** Docker's data-root and containerd's root both belong on
`/srv`. `docker info` reporting `/srv/docker` does not prove the image layers
moved: with the containerd image store they live in containerd's root. To move
it:

```sh
sudo systemctl stop tachy docker containerd
sudo rsync -aHAX /var/lib/containerd/ /srv/containerd/
sudo mv /var/lib/containerd /var/lib/containerd.old
# the playbook sets root = "/srv/containerd" in /etc/containerd/config.toml
sudo systemctl start containerd docker tachy
# once the stack is healthy:
sudo rm -rf /var/lib/containerd.old
```

**Old images:** `docker image prune -a --filter "until=720h"` keeps anything
used in the last 30 days; the running and previous releases are kept anyway.

**`/srv`.** The usual suspects are the backup export (retention runs after each
backup), repo clones (`tachy_tachy-repo-data`), and container logs (the `local`
driver caps each container at 200 MB). Postgres itself:

```sh
docker compose exec -T postgres psql -U tachy -d tachy -c \
  "select relname, pg_size_pretty(pg_total_relation_size(oid)) from pg_class where relkind='r' order by pg_total_relation_size(oid) desc limit 10"
```

`code_chunks` is most of the database; unlinking a large repository frees it.
