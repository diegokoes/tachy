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
# The commit the playbook last ran from, which it writes.
TACHY_HOST_RELEASE_FILE=${TACHY_HOST_RELEASE_FILE:-/etc/tachy/host-release}
# What the playbook installs on the host out of a checkout.
HOST_SCRIPT_PATHS=(deploy/host deploy/backup deploy/watch deploy/postgres/schema-hazards.sh)

# app_env <name> [default]: a value from the stack's .env
app_env() {
  local v
  v=$(sed -n "s/^$1=//p" "$TACHY_DIR/.env" 2>/dev/null | tail -1)
  echo "${v:-${2:-}}"
}

# set_env <name> <value>: sets or replaces one line of the stack's .env
set_env() {
  local key=$1 value=$2 file="$TACHY_DIR/.env"
  if grep -q "^$key=" "$file"; then
    sed -i "s|^$key=.*|$key=$value|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

project() {
  app_env COMPOSE_PROJECT_NAME tachy
}

# checkout_git <args>: git in the checkout, as its owner. git refuses a
# repository that belongs to another user, root included.
checkout_git() {
  if [ "$(id -u)" = 0 ]; then
    runuser -u "$(stat -c %U "$TACHY_DIR")" -- git -C "$TACHY_DIR" "$@"
  else
    git -C "$TACHY_DIR" "$@"
  fi
}

# host_scripts_differ <commit>: whether that commit's host scripts are other
# than the installed ones. True as well when the commit they came from is not
# in the checkout; false while the host records none.
host_scripts_differ() {
  local installed
  installed=$(cat "$TACHY_HOST_RELEASE_FILE" 2>/dev/null || true)
  [ -n "$installed" ] && [ "$installed" != "$1" ] || return 1
  checkout_git cat-file -e "$installed^{commit}" 2>/dev/null || return 0
  ! checkout_git diff --quiet "$installed" "$1" -- "${HOST_SCRIPT_PATHS[@]}"
}

dc() {
  # shellcheck disable=SC2086
  (cd "$TACHY_DIR" && docker compose $TACHY_COMPOSE_FILES "$@")
}

# wait_ready: readyz through Caddy, for up to TACHY_READY_TIMEOUT seconds
wait_ready() {
  local host deadline port=${TACHY_HTTPS_PORT:-443}
  host=$(app_env TACHY_HOSTNAME localhost)
  deadline=$(($(date +%s) + ${TACHY_READY_TIMEOUT:-300}))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -fsk -m 5 --resolve "$host:$port:127.0.0.1" \
      "https://$host:$port/readyz" 2>/dev/null | grep -q '"ready":true'; then
      return 0
    fi
    sleep 3
  done
  return 1
}

# resolve_image <commit> [tag prefix]: the image CI built from the commit, by
# digest once pulled. PULL=false takes the image already on the host.
resolve_image() {
  local sha=$1 prefix=${2:-} repo=${TACHY_IMAGE_REPO:-ghcr.io/diegokoes/tachy} tag digest
  tag="$repo:${prefix}sha-${sha:0:12}"
  ${PULL:-true} && docker pull -q "$tag" >/dev/null
  digest=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$tag" 2>/dev/null |
    grep "^$repo@" | head -1)
  echo "${digest:-$tag}"
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
