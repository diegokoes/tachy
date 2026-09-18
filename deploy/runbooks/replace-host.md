# Replacing the host

1. A replacement machine with Debian 13: LUKS, then enrol the TPM so it boots
   unattended: `sudo systemd-cryptenroll --tpm2-device=auto --tpm2-pcrs=7 /dev/<luks partition>`
   and add `tpm2-device=auto` to its line in `/etc/crypttab`.
2. Same DNS name (the certificate, the OIDC redirect and the downloaders' known
   hosts all bind to it). Update the DHCP reservation to the new MAC.
3. [first-install.md](first-install.md) steps 4–8, with the `.env` secrets from
   the password manager.
4. Restore the newest database, agent-home and Caddy CA archives
   ([backups-and-restore.md](backups-and-restore.md)). Restoring `caddy-data`
   keeps every client's trust.
5. The host key changed: publish the new line to downloaders.
6. `tachy-deploy <commit from the old deploy log>`, or `main`.
7. Record the time from start to a green `/readyz`. The RTO target for this
   profile is 4 hours.
