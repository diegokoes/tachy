#!/usr/bin/env bash
# Records which schema.sql built this database, for /readyz. Usage:
#   schema-stamp.sh [path/to/schema.sql]
set -euo pipefail

schema=${1:-/docker-entrypoint-initdb.d/10-schema.sql}
hash=$(sha256sum "$schema" | cut -d' ' -f1)

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-tachy}" --dbname "${POSTGRES_DB:-tachy}" -v hash="$hash" <<'SQL'
insert into schema_meta (schema_sha256) values (:'hash')
on conflict (id) do update set schema_sha256 = excluded.schema_sha256, applied_at = now();
SQL
