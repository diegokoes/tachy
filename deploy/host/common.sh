# shellcheck shell=bash
# Shared by the host scripts (tachy-backup, tachy-watch, tachy-deploy).
# Settings come from /etc/tachy/tachy.env (root:tachy 0640); see
# deploy/host/tachy.env.example.

TACHY_ENV_FILE=${TACHY_ENV_FILE:-/etc/tachy/tachy.env}
TACHY_ENV_DIR=$(dirname "$TACHY_ENV_FILE")
if [ -r "$TACHY_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$TACHY_ENV_FILE"
elif [ -e "$TACHY_ENV_FILE" ] || { [ -d "$TACHY_ENV_DIR" ] && [ ! -x "$TACHY_ENV_DIR" ]; }; then
  # A file that is there and unreadable must not look like a file that is absent.
  echo "$(id -un) cannot read $TACHY_ENV_FILE" >&2
  exit 1
fi

TACHY_DIR=${TACHY_DIR:-/opt/tachy}
TACHY_SRV=${TACHY_SRV:-/srv/tachy}
TACHY_STATUS_DIR=${TACHY_STATUS_DIR:-$TACHY_SRV/status}
TACHY_COMPOSE_FILES=${TACHY_COMPOSE_FILES:--f docker-compose.yml -f deploy/compose.prod.yml}

# app_env <name> [default]: a value from the stack's .env
app_env() {
  local v
  v=$(sed -n "s/^$1=//p" "$TACHY_DIR/.env" 2>/dev/null | tail -1)
  echo "${v:-${2:-}}"
}

project() {
  app_env COMPOSE_PROJECT_NAME tachy
}

dc() {
  # shellcheck disable=SC2086
  (cd "$TACHY_DIR" && docker compose $TACHY_COMPOSE_FILES "$@")
}

utc_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# write_status <name> <json>: atomically replaces $TACHY_STATUS_DIR/<name>.json
write_status() {
  mkdir -p "$TACHY_STATUS_DIR"
  local tmp="$TACHY_STATUS_DIR/.$1.json.partial"
  printf '%s\n' "$2" >"$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$TACHY_STATUS_DIR/$1.json"
}

# append_history <name> <json>: adds one line to $TACHY_STATUS_DIR/<name>.jsonl,
# keeping the newest 60, so the admin page can chart more than the last result
append_history() {
  mkdir -p "$TACHY_STATUS_DIR"
  local file="$TACHY_STATUS_DIR/$1.jsonl" tmp="$TACHY_STATUS_DIR/.$1.jsonl.partial"
  { [ -f "$file" ] && cat "$file"; jq -c . <<<"$2"; } | tail -n 60 >"$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$file"
}

# ping <url> [suffix] [body]: healthchecks.io style; silent when unset
ping() {
  local url=$1 suffix=${2:-} body=${3:-}
  [ -n "$url" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "$body" "$url$suffix" || true
}

log() { printf '%s %s\n' "$(utc_now)" "$*" >&2; }
