#!/usr/bin/env bash
# Starts an install on a fresh Debian 13 host (deploy/runbooks/first-install.md).
#
#   sudo deploy/install.sh [tachy-install options]      from a checkout
#   curl -fsSL https://raw.githubusercontent.com/diegokoes/tachy/main/deploy/install.sh | sudo bash
#
# From a checkout it runs that checkout's installer. Piped in, it clones
# TACHY_REPO at TACHY_BRANCH (main) into a root-owned directory first.
set -euo pipefail
# An install outlives the SSH session it was started from.
trap '' HUP

REPO=${TACHY_REPO:-https://github.com/diegokoes/tachy.git}
BRANCH=${TACHY_BRANCH:-main}
SOURCE_DIR=${TACHY_SOURCE_DIR:-/var/lib/tachy/src}

[ "$(id -u)" = 0 ] || { echo "run it as root: sudo $0" >&2; exit 1; }
# shellcheck source=/dev/null
. /etc/os-release
[ "${ID:-}" = debian ] || { echo "this installs on Debian 13; this is ${PRETTY_NAME:-another system}" >&2; exit 1; }
[ "${VERSION_ID%%.*}" = 13 ] || echo "written for Debian 13; this is ${PRETTY_NAME:-unknown}" >&2

HERE=$(dirname "$(readlink -f "${BASH_SOURCE[0]:-}")" 2>/dev/null || true)
if [ -x "$HERE/host/tachy-install" ]; then
  exec "$HERE/host/tachy-install" "$@"
fi

command -v git >/dev/null || {
  echo "installing git" >&2
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git ca-certificates >/dev/null
}
if [ -d "$SOURCE_DIR/.git" ]; then
  git -C "$SOURCE_DIR" fetch -q --prune origin
  git -C "$SOURCE_DIR" checkout -q --detach "origin/$BRANCH"
else
  echo "fetching $REPO ($BRANCH)" >&2
  mkdir -p "$(dirname "$SOURCE_DIR")"
  git clone -q --branch "$BRANCH" "$REPO" "$SOURCE_DIR"
fi
exec "$SOURCE_DIR/deploy/host/tachy-install" "$@"
