#!/usr/bin/env bash
# Deploy qr-code-generator to a remote host as a Docker container.
#
# Builds the multi-stage image ON the remote host (no Node needed locally) and
# (re)starts the container. Re-run this script to ship updates.
#
# Requirements locally: ssh, rsync.
# Requirements on the remote host: docker, with your SSH key authorized.
#
# Configure via environment variables (only SSH_HOST is required):
#   SSH_HOST    SSH host/alias of the target machine   (required)
#   REMOTE_DIR  Where to sync the source on the host    (default: /opt/qr-code-generator)
#   PORT        Host port to expose the app on          (default: 8080)
#   IMAGE       Docker image name                       (default: qr-code-generator)
#   CONTAINER   Docker container name                   (default: qr-code-generator)
#
# Example:
#   SSH_HOST=myserver PORT=3000 ./deploy.sh
set -euo pipefail

SSH_HOST="${SSH_HOST:?Set SSH_HOST to your server's SSH host/alias, e.g. SSH_HOST=myserver ./deploy.sh}"
REMOTE_DIR="${REMOTE_DIR:-/opt/qr-code-generator}"
PORT="${PORT:-8080}"
IMAGE="${IMAGE:-qr-code-generator}"
CONTAINER="${CONTAINER:-qr-code-generator}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Syncing source to ${SSH_HOST}:${REMOTE_DIR}"
ssh "$SSH_HOST" "mkdir -p '$REMOTE_DIR'"
rsync -az --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  "$SCRIPT_DIR/" "$SSH_HOST:$REMOTE_DIR/"

echo "==> Building image on ${SSH_HOST}"
ssh "$SSH_HOST" "cd '$REMOTE_DIR' && docker build -t '$IMAGE' ."

echo "==> (Re)starting container on port ${PORT}"
ssh "$SSH_HOST" "docker rm -f '$CONTAINER' >/dev/null 2>&1 || true; \
  docker run -d --name '$CONTAINER' --restart unless-stopped -p ${PORT}:80 '$IMAGE'"

echo "==> Pruning dangling images"
ssh "$SSH_HOST" "docker image prune -f >/dev/null 2>&1 || true"

echo ""
echo "==> Deployed: http://${SSH_HOST}:${PORT}"
