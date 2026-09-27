#!/usr/bin/env bash
# Proves a db/schema.sql change can ship as a diff (DEPLOYMENT-ARCHITECTURE.md
# §5.10), against a scratch Postgres with the vector, pg_trgm and pgcrypto
# extensions available:
#
#   scripts/schema-plan.sh <old dir> <new dir>
#
# Each dir holds 10-schema.sql and, where it exists, 20-roles.sql; the old dir
# also holds fixtures.sql.
#
# 1. load the old schema and fixtures into a fresh database, plan the diff to
#    the new schema, and apply it;
# 2. a second plan must be empty;
# 3. a database built fresh from the new schema must also plan empty, which
#    catches any object the tool does not understand.
# Hazards that only cost time or locks on this small database are allowed;
# ones that can lose data or change behaviour need ALLOW_DESTRUCTIVE=1.
#
# Needs pg-schema-diff and psql on PATH, and PGHOST/PGPORT/PGUSER/PGPASSWORD.
set -euo pipefail

old_dir=$1 new_dir=$2
# shellcheck source=../deploy/postgres/schema-hazards.sh
. "$(dirname "$0")/../deploy/postgres/schema-hazards.sh"
allow=$SCHEMA_SAFE_HAZARDS
[ "${ALLOW_DESTRUCTIVE:-0}" = 1 ] && allow="$allow,$SCHEMA_DESTRUCTIVE_HAZARDS"
dsn() { echo "postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT:-5432}/$1?sslmode=disable"; }

psql -v ON_ERROR_STOP=1 -q -d postgres -c 'drop database if exists plan_old' -c 'create database plan_old' \
  -c 'drop database if exists plan_fresh' -c 'create database plan_fresh'
psql -v ON_ERROR_STOP=1 -q -d plan_old -f "$old_dir/10-schema.sql"
[ -f "$old_dir/20-roles.sql" ] && psql -v ON_ERROR_STOP=1 -q -d plan_old -f "$old_dir/20-roles.sql"
psql -v ON_ERROR_STOP=1 -q -d plan_old -f "$old_dir/fixtures.sql"

echo "== plan"
pg-schema-diff plan --from-dsn "$(dsn plan_old)" --to-dir "$new_dir" \
  --data-pack-new-tables=false --output-format pretty | tee schema-plan.txt

echo "== apply (allowed hazards: $allow)"
pg-schema-diff apply --from-dsn "$(dsn plan_old)" --to-dir "$new_dir" \
  --data-pack-new-tables=false --allow-hazards "$allow" --skip-confirm-prompt

echo "== re-plan must be empty"
again=$(pg-schema-diff plan --from-dsn "$(dsn plan_old)" --to-dir "$new_dir" --data-pack-new-tables=false)
[ -z "$(tr -d '[:space:]' <<<"$again")" ] || { echo "$again"; echo "not converged"; exit 1; }

echo "== a fresh database from the new schema must plan empty"
cat "$new_dir"/1*.sql "$new_dir"/2*.sql 2>/dev/null | psql -v ON_ERROR_STOP=1 -q -d plan_fresh
fresh=$(pg-schema-diff plan --from-dsn "$(dsn plan_fresh)" --to-dir "$new_dir" --data-pack-new-tables=false)
[ -z "$(tr -d '[:space:]' <<<"$fresh")" ] || { echo "$fresh"; echo "the tool does not round-trip this schema"; exit 1; }
echo "schema plan ok"
