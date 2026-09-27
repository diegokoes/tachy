#!/usr/bin/env bash
# Gives tachy_app and tachy_backup a login and password from the environment.
# Runs from docker-entrypoint-initdb.d on a fresh volume, and from tachy-deploy
# on an existing database. A role whose variable is unset stays nologin.
set -euo pipefail

psql_args=(-v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-tachy}" --dbname "${POSTGRES_DB:-tachy}")

set_password() {
  local role=$1 password=$2
  [ -n "$password" ] || return 0
  psql "${psql_args[@]}" -v role="$role" -v password="$password" <<'SQL'
alter role :"role" login password :'password';
SQL
}

set_password tachy_app "${TACHY_APP_DB_PASSWORD:-}"
set_password tachy_backup "${TACHY_BACKUP_DB_PASSWORD:-}"
