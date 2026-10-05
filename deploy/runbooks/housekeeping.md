# Housekeeping

**Certificates.** With Caddy's internal CA there is nothing to renew by hand:
leaves last 12 hours and renew themselves, and tachy-watch fails if renewal
stops. An IT-issued certificate is renewed by IT; tachy-watch warns 14 days
ahead. Replace the files in `TACHY_TLS_CERT_DIR` and restart caddy.

**Retention.** `retention.sweep` is a job, daily at 03:30 UTC. Its definition
under Admin › workers › jobs holds `transcript_days` and `usage_months`.

| Data                      | Kept                                      | By                     |
| ------------------------- | ----------------------------------------- | ---------------------- |
| Chat uploads              | 24 h (`TACHY_UPLOAD_TTL_HOURS`)           | `retention.sweep`      |
| Generated exports         | 24 h (`TACHY_OUTPUT_TTL_HOURS`)           | `retention.sweep`      |
| Claude transcripts        | 90 days from last activity                | `retention.sweep`      |
| Usage counters per person | 13 months, then monthly without the user  | `retention.sweep`      |
| Job runs, flow runs       | 90 days, failed ones 180                  | `retention.sweep`      |
| Notifications             | 90 days once opened, 180 if never         | `retention.sweep`      |
| Orphaned library images   | 7 days                                    | `retention.sweep`      |
| Container logs            | 200 MB per container                      | the `local` log driver |
| Journal                   | 1 GB                                      | journald               |
| Backups on the host       | 2 days all, 14 days daily, 8 weeks weekly | `tachy-backup prune`   |

**Incidents.** Whoever sees the Teams alert first acknowledges it in the thread
and owns it until they hand it over there. The workflow needs a co-owner so
alerts survive its owner leaving.
