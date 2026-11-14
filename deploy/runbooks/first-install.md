# First installation

One script sets the host up, starts the stack and leaves what the admin must
keep. It runs on the host itself.

1. **Host.** Debian 13 on wired Ethernet, with a DHCP reservation and an
   internal DNS name. A laptop: with LUKS (see
   [replace-host.md](replace-host.md) for TPM2 unlock). A cloud VM:
   [azure.md](azure.md).
2. **Install.** As a login that has sudo, and whose SSH key is in its
   `authorized_keys`:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/diegokoes/tachy/main/deploy/install.sh | sudo bash
   ```

   or, from a clone, `sudo deploy/install.sh`. It asks:
   - laptop or server (a laptop gets the battery, lid and mDNS settings);
   - the name people open in a browser;
   - which networks may reach the site, and which may reach SSH;
   - the certificate: Caddy's own authority, Let's Encrypt, or files from IT;
   - the branch to follow at night, `main` unless told otherwise;
   - single sign-on: the issuer, client id and secret, or nothing for
     passwords.

   Then, without more questions, it:
   - writes the answers to `/etc/tachy/host.yml`;
   - makes every secret and the two backup key pairs;
   - runs the playbook in `deploy/host` (users, SSH, firewall, Docker, gVisor,
     timers);
   - pulls the images CI built for the branch's head and starts the stack;
   - creates the `watch@<name>` and `smoke@<name>` service accounts and the
     watch token;
   - deploys once with `tachy-deploy`, which takes the first backup and runs
     the smoke test;
   - prints `tachy-install status`, the site's address and the setup code.

   It turns password SSH off. A login with no key in `authorized_keys` is
   asked for one; left empty, password login stays on through
   `/etc/ssh/sshd_config.d/05-password-login.conf` until that file is deleted.

3. **Wizard.** Open `https://<name>/` and create the admin with the setup code
   the installer printed. The installer waits for that, then removes the
   first-start token (`TACHY_API_TOKEN`) and restarts the api. After ctrl-c,
   or an install with nobody at it: `sudo tachy-install finish`.
4. **Admin kit.** `/root/tachy-admin-kit/` holds the generated secrets, the
   two backup private keys and Caddy's root certificate; its `README.txt` says
   what each is. Copy the folder to the password manager, then delete it with
   the command in the README. `tachy-watch` warns while a private key is on
   the host.
5. **Trust.** With Caddy's own authority, clients install the root once:
   [tls-client-trust.md](tls-client-trust.md). The installer left a copy at
   `/etc/tachy/caddy-root.crt` for tachy-watch.
6. **What is left.** `sudo tachy-install status` lists it. Usually:
   - `TEAMS_WEBHOOK_URL` and the three `HC_*_URL` healthchecks.io ping URLs in
     `/etc/tachy/tachy.env` (one check each: backup every 6 h with a 1 h
     grace, restore test weekly, watch every minute with 5 min grace);
   - backup downloaders, in `/etc/tachy/host.yml`
     ([backups-and-restore.md](backups-and-restore.md)), then `sudo
tachy-install` and `WATCH_DOWNLOADS=1`;
   - on another host than the 16 GB laptop, the `Host sizing` block of
     `.env.example` in `/opt/tachy/.env`. The installer has already lowered
     a CPU limit that was above the host's cores.
7. **Prove the alerts.** `sudo tachy-watch --force disk_srv=fail`, then run it
   plainly; both messages must arrive in Teams. Pull the network cable for
   10 minutes; healthchecks.io must alert.

## The files

| File                     | Holds                                                                | Change it by                                    |
| ------------------------ | -------------------------------------------------------------------- | ----------------------------------------------- |
| `/etc/tachy/host.yml`    | the host: admins, who may reach it, profile, downloaders             | editing it, then `sudo tachy-install`           |
| `/etc/tachy/tachy.env`   | the host scripts' settings: alerts, the watch token, the smoke login | editing it; the scripts read it on every run    |
| `/opt/tachy/.env`        | the stack's settings and secrets                                     | editing it, then `sudo systemctl restart tachy` |
| `/root/tachy-admin-kit/` | what goes to the password manager                                    | nothing: it is deleted once copied              |

`tachy-install` writes a key of the two env files only while it is missing or
empty, so running it again keeps every secret and every edit. A run also
takes up a first start that was cut short, makes the watch token or the smoke
login again when the api refuses the one in `tachy.env`, and exports Caddy's
root again. It outlives the SSH session it was started from and logs to
`/var/log/tachy-install.log`. `deploy/host/host.example.yml` explains each key
of `host.yml`.

## With nobody at it

Write `/etc/tachy/host.yml` first, from `deploy/host/host.example.yml`, and
run `install.sh --unattended`. It asks nothing and does not wait for the
wizard. `OIDC_CLIENT_SECRET`, `TEAMS_WEBHOOK_URL` and the `HC_*_URL` values are
taken from its environment when set. Left out of `host.yml`,
`backup_recipients` are made and their private halves written to the kit.

## Starting on another release

`install.sh --ref <commit|branch>` starts on that release. CI has to have
published its images: a head merged minutes ago may not have them yet, and the
installer says so and can be run again.

## A host that ran tachy before

To start over on a host without installing its system again, take the old
install off first:

```sh
curl -fsSL https://raw.githubusercontent.com/diegokoes/tachy/main/deploy/install.sh | sudo bash -s -- reset
```

or `sudo tachy-install reset` where the installer is already on the host. It
lists what it removes and asks for the host's name before it does:

- removed: the containers, networks and volumes of the stack (the database,
  the chat transcripts, the repository clones, Caddy's authority),
  `/opt/tachy`, `/etc/tachy`, and the deploy log and status files under
  `/srv/tachy`;
- kept: the system the playbook set up (users, SSH, the firewall, Docker,
  gVisor), the encrypted backups in `/srv/tachy/backup-export`, and in
  `/root/tachy-reset-<time>` the old `host.yml` or `inventory.yml`, the admin
  kit if it was still on the host, and the vault key the credentials inside
  those backups need.

Then install as on a new host. Clients install Caddy's root again: the new
install has a new authority. The old backups stay readable with the old
private keys only, and age out of the export folder by its retention.

## A host that ran Docker before

Old volumes under `/srv/docker` become visible once the playbook moves
Docker's data there. The installer refuses to start on a
`tachy_tachy-postgres-data` volume from an earlier install: its passwords are
not the ones just made. `docker volume ls`, remove what is stale, and run it
again.

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
