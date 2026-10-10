#!/usr/bin/env bash
# The container smoke test CI runs on the built image (tachy:ci by default):
#
#   scripts/container-smoke.sh up      write a throwaway .env, start the stack
#   scripts/container-smoke.sh smoke   seed small data, run load/smoke.js
#   scripts/container-smoke.sh prod    the same data under deploy/compose.prod.yml:
#                                      smoke.js again, then one chat turn against
#                                      the mock model
#
# It writes .env in the current checkout, so run it only in a CI checkout or a
# scratch clone. On a machine that already runs a stack, set SMOKE_PROJECT,
# SMOKE_API_PORT and SMOKE_PG_PORT so nothing collides with it.
set -euo pipefail

image=${TACHY_IMAGE:-tachy:ci}
project=${SMOKE_PROJECT:-tachy}
api_port=${SMOKE_API_PORT:-8787}
pg_port=${SMOKE_PG_PORT:-5433}
host=${SMOKE_HOSTNAME:-tachy.test}

case "${1:-}" in
up)
  # The role passwords are in from the first start: Postgres sets them when it
  # makes the volume, and `prod` connects as those roles.
  cat >.env <<ENV
COMPOSE_PROJECT_NAME=$project
TACHY_API_PORT=$api_port
TACHY_PG_PORT=$pg_port
TACHY_IMAGE=$image
NODE_ENV=development
POSTGRES_PASSWORD=ci
DATABASE_URL=postgres://tachy:ci@localhost:$pg_port/tachy
TACHY_API_TOKEN=ci-token
TACHY_SESSION_SECRET=ci-session-secret-that-is-at-least-32-chars
TACHY_APP_DB_PASSWORD=ci-app
TACHY_MCP_DB_PASSWORD=ci-mcp
TACHY_BACKUP_DB_PASSWORD=ci-backup
ENV
  docker compose up -d --no-build postgres api
  for _ in $(seq 90); do
    if curl -fs "localhost:$api_port/readyz" | grep -q '"ready":true'; then
      echo ready
      exit 0
    fi
    sleep 2
  done
  curl -s "localhost:$api_port/readyz" || true
  echo "the api did not become ready" >&2
  exit 1
  ;;
smoke)
  docker compose run --rm cli npm run sync -- seed --scale=small --reset --yes
  k6=$(sed -n 's/^ *image: *\(grafana\/k6:[^ ]*\) *$/\1/p' load/k6.compose.yml)
  docker run --rm --network "$project" -v "$PWD/load:/load:ro" \
    -e BASE_URL=http://api:8787 "$k6" run --quiet /load/smoke.js
  ;;
prod)
  # What only the overlay has: Caddy and TLS, the read-only root, the
  # least-privilege roles, the embedder and the two workers. The CPU limits
  # are the runner's, which has fewer cores than the overlay's defaults ask for.
  cat >>.env <<ENV
TACHY_HOSTNAME=$host
TACHY_INTERNAL_SECRET=ci-internal-secret
TACHY_SECRET_KEY=$(openssl rand -base64 32)
TACHY_STATUS_HOST_DIR=$PWD/.smoke-status
TACHY_EMBEDDER_CPUS=2
TACHY_WORKER_HEAVY_CPUS=2
ANTHROPIC_BASE_URL=http://mock-llm:4010
ANTHROPIC_API_KEY=sk-mock-not-a-key
ENV
  mkdir -p .smoke-status
  overlay=(-f docker-compose.yml -f deploy/compose.prod.yml)
  docker compose "${overlay[@]}" up -d --no-build

  ready=false
  for _ in $(seq 150); do
    if curl -fsk -m 5 --resolve "$host:443:127.0.0.1" "https://$host/readyz" |
      grep -q '"ready":true'; then
      ready=true
      break
    fi
    sleep 2
  done
  if ! $ready; then
    docker compose "${overlay[@]}" ps
    echo "the overlay did not become ready through Caddy" >&2
    exit 1
  fi
  echo ready

  k6=$(sed -n 's/^ *image: *\(grafana\/k6:[^ ]*\) *$/\1/p' load/k6.compose.yml)
  docker run --rm --network "$project" -v "$PWD/load:/load:ro" \
    -e BASE_URL=http://api:8787 "$k6" run --quiet /load/smoke.js

  # One chat turn, so the tools process runs as tachy_mcp on the read-only
  # root and embeds through the embedder. The mock model is the image's own.
  docker run -d --rm --name "$project-mock-llm" --network "$project" \
    --network-alias mock-llm -e MOCK_PORT=4010 -e MOCK_DELAY_MS=200 \
    "$image" node load/mock-llm/server.mjs >/dev/null
  trap 'docker rm -f "$project-mock-llm" >/dev/null 2>&1 || true' EXIT
  turns=$(docker compose "${overlay[@]}" exec -T -e LEVELS=1 \
    -e BASE_URL=http://127.0.0.1:8787 api node load/turns.mjs)
  echo "$turns"
  if ! grep -q '"concurrent":1,"ok":1,' <<<"$turns"; then
    echo "the chat turn did not finish" >&2
    exit 1
  fi
  tools=$(docker compose "${overlay[@]}" logs --no-log-prefix api |
    grep '"event":"mcp_tool"' || true)
  if [ "$(grep -c '"ok":true' <<<"$tools")" -lt 2 ] || grep -q '"ok":false' <<<"$tools"; then
    echo "$tools"
    echo "the turn's tool calls did not all succeed" >&2
    exit 1
  fi
  echo "tool calls ok: $(grep -c '"ok":true' <<<"$tools")"
  ;;
*)
  echo "usage: container-smoke.sh up|smoke|prod" >&2
  exit 2
  ;;
esac
