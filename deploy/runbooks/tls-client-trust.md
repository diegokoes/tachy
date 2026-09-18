# Trusting the server's certificate

With `TACHY_TLS=internal`, Caddy signs the site's certificate with its own root,
valid for 10 years. A browser trusts it only once that root is installed.

**Export it (on the host, as tachy):**

```sh
cd /opt/tachy
docker compose -f docker-compose.yml -f deploy/compose.prod.yml \
  cp caddy:/data/caddy/pki/authorities/local/root.crt tachy-root.crt
sha256sum tachy-root.crt   # publish this fingerprint with the file
```

The root is not secret; its private key never leaves the `caddy-data` volume
(and its encrypted backup). Put `tachy-root.crt` where people can fetch it.

**Windows, per machine (admin PowerShell):**

```powershell
Get-FileHash .\tachy-root.crt          # compare with the published fingerprint
Import-Certificate -FilePath .\tachy-root.crt -CertStoreLocation Cert:\LocalMachine\Root
```

Without admin rights: double-click the file → Install Certificate → Current User
→ Trusted Root Certification Authorities. Edge and Chrome use the Windows store.
Firefox needs `security.enterprise_roots.enabled` set to `true` in
`about:config`.

**Every machine at once:** IT deploys the file as a trusted root through Group
Policy or Intune. Ask IT first whether installing a private root is allowed.

**If the `caddy-data` volume is ever lost,** Caddy creates a new root and every
client must install again. Restore the volume from the newest
`tachy-caddy-data-*.tar.zst.age` instead (see
[backups-and-restore.md](backups-and-restore.md)).

**Switching to an IT-issued certificate:** put `tachy.crt` and `tachy.key` in a
directory, set `TACHY_TLS_CERT_DIR` to it and
`TACHY_TLS=/certs/tachy.crt /certs/tachy.key` in `.env`, then
`sudo systemctl restart tachy`. Nothing changes on the clients.
