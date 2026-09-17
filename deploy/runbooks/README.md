# Runbooks

Short, command-first procedures for the office host. The reasoning behind them
is in [DEPLOYMENT-ARCHITECTURE.md](../../DEPLOYMENT-ARCHITECTURE.md).

| Runbook                                          | When                                                      |
| ------------------------------------------------ | --------------------------------------------------------- |
| [first-install.md](first-install.md)             | A new or rebuilt host, through to the setup wizard        |
| [tls-client-trust.md](tls-client-trust.md)       | A laptop shows "Your connection is not private"           |
| [deploy-and-rollback.md](deploy-and-rollback.md) | Every release; reading the deploy log                     |
| [schema-change.md](schema-change.md)             | A release changes `db/schema.sql`                         |
| [maintenance.md](maintenance.md)                 | Draining before maintenance, monthly updates, reboots     |
| [backups-and-restore.md](backups-and-restore.md) | Downloaders, restoring, the quarterly drill, key rotation |
| [credentials.md](credentials.md)                 | Rotating secrets                                          |
| [full-disk.md](full-disk.md)                     | A disk alert, including the 12 GB `/var`                  |
| [replace-host.md](replace-host.md)               | The laptop is lost or dead                                |
| [upgrades.md](upgrades.md)                       | Postgres, pgvector, the embedding model                   |
| [investigation.md](investigation.md)             | Slow search, a stuck turn, a failed sync or index         |
| [load-window.md](load-window.md)                 | Measuring the laptop outside working hours                |
| [housekeeping.md](housekeeping.md)               | Certificates, retention, who owns an incident             |
