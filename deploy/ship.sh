#!/bin/sh
# puts the committed code on a server by hand (no ci/cd): sends the source over ssh, builds the
# image there, removes the source and the build cache again, then restarts the container.
# the server keeps only /opt/custock/compose.yml, /opt/custock/.env and the data volume.
#
#   CUSTOCK_SSH=root@host CUSTOCK_SSH_KEY=~/.ssh/key sh deploy/ship.sh
#
# optional: CUSTOCK_BASE_PATH (default /custock), CUSTOCK_DIR (default /opt/custock)
set -eu
: "${CUSTOCK_SSH:?set CUSTOCK_SSH=user@host}"
base="${CUSTOCK_BASE_PATH:-/custock}"
dir="${CUSTOCK_DIR:-/opt/custock}"
key=""
[ -n "${CUSTOCK_SSH_KEY:-}" ] && key="-i $CUSTOCK_SSH_KEY"
rev=$(git rev-parse --short HEAD)
built=$(date -u +%Y-%m-%dT%H:%M:%SZ)
[ -z "$(git status --porcelain -- apps packages deploy)" ] || echo "note: uncommitted changes are not shipped, only $rev"

echo "sending $rev"
git archive --format=tar HEAD | ssh $key "$CUSTOCK_SSH" "rm -rf /tmp/custock-src && mkdir -p /tmp/custock-src && tar -x -C /tmp/custock-src"
ssh $key "$CUSTOCK_SSH" "cp /tmp/custock-src/deploy/compose.server.yml $dir/compose.yml"

echo "building on the server"
ssh $key "$CUSTOCK_SSH" "set -e
  docker build -q -f /tmp/custock-src/deploy/Dockerfile --build-arg CUSTOCK_BASE_PATH=$base --build-arg CUSTOCK_REV=$rev --build-arg CUSTOCK_BUILT_AT=$built --label custock.rev=$rev -t custock:latest /tmp/custock-src
  rm -rf /tmp/custock-src
  cd $dir && docker compose up -d
  docker builder prune -af >/dev/null
  docker image prune -f --filter label=custock.rev >/dev/null
  docker image ls custock --format '{{.Repository}}:{{.Tag}} {{.Size}}'"
echo "done, $rev is running"
