# First installation

1. **Host.** Debian 13 with LUKS (see [replace-host.md](replace-host.md) for
   TPM2 unlock), wired Ethernet, a DHCP reservation and an internal DNS name.
2. **Inventory.** On the operator's machine:
   `cp deploy/host/inventory.example.yml deploy/host/inventory.yml` and fill in
   admins, `lan_interface`, `lan_cidrs`, `ssh_allowed_cidrs`, downloaders and
   `backup_recipients`. `inventory.yml` is not committed.
3. **Backup keys.** `age-keygen -o team.key` and `age-keygen -o breakglass.key`
   on a trusted machine. Put both private files in the password manager, copy
   the two `age1…` public keys into `backup_recipients`, then delete the files.
4. **Playbook.**
   `ansible-playbook -i deploy/host/inventory.yml deploy/host/playbook.yml --ask-become-pass`.
   It fails early if the account running it is not in `admin_users`.
5. **Host settings.** `sudoedit /etc/tachy/tachy.env`: `TEAMS_WEBHOOK_URL`,
   the `HC_*_URL` healthchecks.io ping URLs (one check each: backup every 6 h
   with a 1 h grace, restore test weekly, watch every minute with 5 min grace),
   `SMOKE_EMAIL`/`SMOKE_PASSWORD`, and `WATCH_DOWNLOADS=0` until two people
   have downloaded.
6. **App settings.** As `tachy`, in `/opt/tachy`: `cp .env.example .env`,
   `chmod 600 .env`, and set `TACHY_IMAGE` (a digest from CI),
   `TACHY_HOSTNAME`, `POSTGRES_PASSWORD`, `TACHY_APP_DB_PASSWORD`,
   `TACHY_BACKUP_DB_PASSWORD`, `TACHY_SECRET_KEY`, `TACHY_SESSION_SECRET`,
   `TACHY_API_TOKEN` (tachy-watch reads the runtime block with it). Generate
   each with `openssl rand -base64 32` and store it in the password manager.
7. **Registry login.** As `tachy`:
   `docker login ghcr.io -u <github user>` with a classic token carrying only
   `read:packages`.
8. **Start.** `sudo systemctl start tachy`. A fresh volume applies
   `schema.sql`, `roles.sql`, the role passwords and the schema stamp.
9. **Trust.** Export Caddy's root and follow
   [tls-client-trust.md](tls-client-trust.md). Save a copy as
   `/etc/tachy/caddy-root.crt` for tachy-watch.
10. **Wizard.** Open `https://<name>/`, create the admin, then in Admin › access › users & roles
    create the load-test user: member, service account, password under SSO.
11. **Prove the alerts.** `sudo tachy-watch --force disk_srv=fail`, then run it
    plainly; both messages must arrive in Teams. Pull the network cable for
    10 minutes; healthchecks.io must alert.

## An existing database from before the stamp

`/readyz` reports `schema: unstamped` and stays ready. Once the live schema has
been compared with `db/schema.sql` (see [schema-change.md](schema-change.md)),
record it with `tachy-deploy stamp`, and apply the roles once:

```sh
cd /opt/tachy
C="docker compose -f docker-compose.yml -f deploy/compose.prod.yml"
$C exec -T postgres psql -U tachy -d tachy -f - < db/roles.sql
$C exec -T postgres bash /docker-entrypoint-initdb.d/30-role-passwords.sh
```

Then set the api's `DATABASE_URL` user to `tachy_app` (compose.prod.yml does
this) and `sudo systemctl restart tachy`.
