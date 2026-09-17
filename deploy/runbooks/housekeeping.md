# Housekeeping

**Certificates.** With Caddy's internal CA there is nothing to renew by hand:
leaves last 12 hours and renew themselves, and tachy-watch fails if renewal
stops. An IT-issued certificate is renewed by IT; tachy-watch warns 14 days
ahead. Replace the files in `TACHY_TLS_CERT_DIR` and restart caddy.

**Retention, as it stands:**

| Data                      | Kept                                          | By                            |
| ------------------------- | --------------------------------------------- | ----------------------------- |
| Chat uploads              | 24 h (`TACHY_UPLOAD_TTL_HOURS`)               | hourly sweep in the api       |
| Generated exports         | 24 h                                          | hourly sweep in the api       |
| Container logs            | 200 MB per container                          | the `local` log driver        |
| Journal                   | 1 GB                                          | journald                      |
| Backups on the host       | 2 days all, 14 days daily, 8 weeks weekly     | `tachy-backup prune`          |
| Claude transcripts        | 90 days from last activity (policy)           | Phase 2 `retention.sweep` job |
| Usage counters per person | 13 months, then monthly without user (policy) | Phase 2 `retention.sweep` job |

**Incidents.** Whoever sees the Teams alert first acknowledges it in the thread
and owns it until they hand it over there. The workflow needs a co-owner so
alerts survive its owner leaving.
