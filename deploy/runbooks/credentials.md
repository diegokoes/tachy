# Rotating credentials

Every secret below also lives in the password manager; update it there first.

| Secret                                     | Where                  | Rotate by                                                                                                                                                                          | Effect                                  |
| ------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `TACHY_SESSION_SECRET`                     | `/opt/tachy/.env`      | new value, `sudo systemctl restart tachy`                                                                                                                                          | everyone is logged out                  |
| `TACHY_API_TOKEN`                          | `/opt/tachy/.env`      | new value, restart; update any integration using it                                                                                                                                | tachy-watch reads it from the same file |
| Source tokens (Freshdesk, GitHub, ADO)     | the vault              | Admin › access › shared credentials (global) or each user's own settings                                                                                                           | next turn and sync use the new token    |
| Provider keys (Anthropic, Copilot)         | the vault              | Admin › access › shared credentials                                                                                                                                                | next turn                               |
| `POSTGRES_PASSWORD`, `TACHY_*_DB_PASSWORD` | `.env`                 | `alter role … password` in psql, then `.env`, then restart                                                                                                                         | brief api restart                       |
| `TEAMS_WEBHOOK_URL`, `HC_*_URL`            | `/etc/tachy/tachy.env` | new workflow or check, then the file                                                                                                                                               | none                                    |
| OIDC client secret                         | `.env`                 | new secret in Entra, `.env`, restart                                                                                                                                               | new logins only                         |
| `TACHY_SECRET_KEY` (vault)                 | `.env`                 | put the old key in `TACHY_SECRET_KEY_PREVIOUS` and a new one in `TACHY_SECRET_KEY`, restart, run `docker compose run --rm cli npm run sync rotate-key`, then drop the previous key | none; rows move key by key              |
| Backup age keys                            | password manager       | [backups-and-restore.md](backups-and-restore.md)                                                                                                                                   | future backups                          |

## Rotating the vault key

Every stored credential names the key that wrote it, so a rotation is online:

1. `openssl rand -base64 32` for the new key; put it in the password manager.
2. In `/opt/tachy/.env`: move the current `TACHY_SECRET_KEY` value to
   `TACHY_SECRET_KEY_PREVIOUS`, put the new one in `TACHY_SECRET_KEY`.
3. `sudo systemctl restart tachy`. Everything still opens: rows written with the
   old key name it, and it is still configured.
4. `docker compose run --rm cli npm run sync rotate-key` re-encrypts every row
   with the new key. Admin › system shows the count per key.
5. Once every row is on the new key, remove `TACHY_SECRET_KEY_PREVIOUS` and
   restart. Keep the old key in the password manager until the last backup
   encrypted with it has aged out, since restoring one needs it.
