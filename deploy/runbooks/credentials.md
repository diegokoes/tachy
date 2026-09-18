# Rotating credentials

Every secret below also lives in the password manager; update it there first.

| Secret                                     | Where                  | Rotate by                                                                                                        | Effect                                  |
| ------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `TACHY_SESSION_SECRET`                     | `/opt/tachy/.env`      | new value, `sudo systemctl restart tachy`                                                                        | everyone is logged out                  |
| `TACHY_API_TOKEN`                          | `/opt/tachy/.env`      | new value, restart; update any integration using it                                                              | tachy-watch reads it from the same file |
| Source tokens (Freshdesk, GitHub, ADO)     | the vault              | Admin › access › shared credentials (global) or each user's own settings                                         | next turn and sync use the new token    |
| Provider keys (Anthropic, Copilot)         | the vault              | Admin › access › shared credentials                                                                              | next turn                               |
| `POSTGRES_PASSWORD`, `TACHY_*_DB_PASSWORD` | `.env`                 | `alter role … password` in psql, then `.env`, then restart                                                       | brief api restart                       |
| `TEAMS_WEBHOOK_URL`, `HC_*_URL`            | `/etc/tachy/tachy.env` | new workflow or check, then the file                                                                             | none                                    |
| OIDC client secret                         | `.env`                 | new secret in Entra, `.env`, restart                                                                             | new logins only                         |
| `TACHY_SECRET_KEY` (vault)                 | `.env`                 | not yet: ciphertext carries no key id, so rotating means decrypting and re-encrypting every row offline. Planned | —                                       |
| Backup age keys                            | password manager       | [backups-and-restore.md](backups-and-restore.md)                                                                 | future backups                          |
