#!/usr/bin/env bash
# The container smoke test CI runs on the built image (tachy:ci by default):
#
#   scripts/container-smoke.sh up      write a throwaway .env, start the stack
#   scripts/container-smoke.sh smoke   seed small data, run load/smoke.js
#
# It writes .env in the current checkout, so run it only in a CI checkout or a
# scratch clone. On a machine that already runs a stack, set SMOKE_PROJECT,
# SMOKE_API_PORT and SMOKE_PG_PORT so nothing collides with it.
set -euo pipefail

image=${TACHY_IMAGE:-tachy:ci}
project=${SMOKE_PROJECT:-tachy}
api_port=${SMOKE_API_PORT:-8787}
pg_port=${SMOKE_PG_PORT:-5433}

case "${1:-}" in
up)
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
  docker run --rm --network "$project" -v "$PWD/load:/load:ro" \
    -e BASE_URL=http://api:8787 grafana/k6:2.2.0 run --quiet /load/smoke.js
  ;;
*)
  echo "usage: container-smoke.sh up|smoke" >&2
  exit 2
  ;;
esac
