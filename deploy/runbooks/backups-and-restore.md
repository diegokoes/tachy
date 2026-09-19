# Backups and restore

Backups are produced on the host (`tachy-backup`, systemd timers) and pulled
over read-only SFTP by people's laptops. Nothing ever pushes them anywhere.

| Timer                      | Runs          | Produces                                        |
| -------------------------- | ------------- | ----------------------------------------------- |
| `tachy-backup-db.timer`    | every 6 h     | `tachy-db-<ts>.dump.age` + `.sha256`            |
| `tachy-restore-test.timer` | Sundays 03:45 | the same, after a restore into a scratch server |
| `tachy-backup-files.timer` | daily 02:30   | agent-home and Caddy CA archives                |

Status: `jq . /srv/tachy/status/{backup,restore,downloads}.json`, or Admin ›
System. The last 60 results of each are in `backup.jsonl` / `restore.jsonl`
beside them, which is what the system overview charts. Run one now:
`sudo tachy-backup db --restore-test`.

## Adding a downloader

1. On their Windows laptop, in PowerShell:
   `ssh-keygen -t ed25519 -f $HOME\.ssh\tachy_backup` (give it a passphrase).
2. They send `tachy_backup.pub`. Add it to `backup_downloaders` in the
   inventory and rerun the playbook.
3. Give them the host key line for `~/.ssh/tachy_known_hosts`, taken on the
   host with `ssh-keyscan -t ed25519 <name>` and checked against
   `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`.
4. They copy `deploy/backup/Get-TachyBackup.ps1` somewhere on their PATH, and
   `backup-connections.example.json` to
   `%APPDATA%\tachy\backup-connections.json` with their user name, then run
   `Get-TachyBackup`. The laptop must be company-managed with BitLocker on.
5. Confirm the download is attributed:
   `sudo tachy-watch --dry-run | grep laptop_downloads`. If it is not, compare
   `journalctl -u ssh --since today` with the patterns in
   `deploy/watch/tachy-watch` (`session opened for local user`,
   `close "…" bytes read`) and adjust them.

**Removing one:** delete the entry and rerun the playbook; the login is removed.

## Restoring

Use the newest good copy: on the host (`/srv/tachy/backup-export`) if it
survived, otherwise a laptop's. The laptop is only the courier: copy the
`.age` file to the host and decrypt there.

```sh
sha256sum -c tachy-db-<ts>.dump.age.sha256
age -d -i <team.key from the password manager> -o /srv/tachy/backups/restore.dump tachy-db-<ts>.dump.age
C="docker compose -f docker-compose.yml -f deploy/compose.prod.yml"
$C stop api caddy
$C exec -T postgres psql -U tachy -d postgres -c 'drop database tachy with (force)' -c 'create database tachy'
$C exec -T postgres pg_restore --no-owner -U tachy -d tachy < /srv/tachy/backups/restore.dump
$C exec -T postgres psql -U tachy -d tachy -f - < db/roles.sql
shred -u /srv/tachy/backups/restore.dump
$C up -d
```

Vault credentials need the original `TACHY_SECRET_KEY`. Agent-home and Caddy's
CA restore into their volumes:
`age -d -i team.key <file> | zstd -dc | docker run --rm -i -v tachy_tachy-agent-home:/data busybox tar -C /data -xf -`
(`tachy_caddy-data` for the CA).

## Quarterly drill, from a laptop copy

1. `winget install --id FiloSottile.age`, and take the team key from the
   password manager.
2. Decrypt a laptop copy, restore it into a scratch Postgres on the pinned image
   (Docker Desktop, or any Linux machine), and compare row counts with
   production.
3. Record the date and how long it took. The RTO is based on this.

## Rotating the team backup key

When someone with access to it leaves: generate a new key, replace its public
half in `backup_recipients`, rerun the playbook. Keep the old private key in
the password manager until the last backup encrypted to it has aged out
(8 weeks).
