# Replacing the host

The new host gets secrets of its own from the installer. Three things come
from the old one: `TACHY_SECRET_KEY`, which opens the credentials stored in
the app, the backups, and `host.yml` if a copy was kept.

1. A replacement machine with Debian 13. A laptop: LUKS, then enrol the TPM so
   it boots unattended:
   `sudo systemd-cryptenroll --tpm2-device=auto --tpm2-pcrs=7 /dev/<luks partition>`
   and add `tpm2-device=auto` to its line in `/etc/crypttab`.
2. Same DNS name (the certificate, the OIDC redirect and the downloaders' known
   hosts all bind to it). Update the DHCP reservation to the new MAC.
3. Install ([first-install.md](first-install.md)). With the old
   `/etc/tachy/host.yml` in place first, `install.sh --unattended` asks
   nothing and keeps encrypting backups to the keys the password manager
   already holds. Without it, answer the questions: the installer makes a new
   pair of backup keys, and the old private keys stay needed for the old
   backups. Do not run the wizard: the restored database brings its admin.
4. In `/opt/tachy/.env`, replace `TACHY_SECRET_KEY` with the old host's, from
   the password manager.
5. Restore the newest database, agent-home and Caddy CA archives
   ([backups-and-restore.md](backups-and-restore.md)). Restoring `caddy-data`
   keeps every client's trust.
6. `sudo tachy-install`. The restored database does not know this host's
   watch token or smoke login, and the exported root certificate is the one
   Caddy made before the restore: the run makes both accounts again, exports
   the restored root and removes the first-start token.
7. `sudo tachy-watch --dry-run` lists `readyz` and `runtime` as `ok`, and
   `tachy-deploy <commit from the old deploy log>`, or `main`, passes its
   smoke run.
8. The host key changed: publish the new line to downloaders.
9. Record the time from start to a green `/readyz`. The RTO target for this
   profile is 4 hours.

Everyone signs in again: the session secret is new.
