#!/bin/sh
# deploy.sh <tag>: runs on the server from /opt/automations
set -eu
cd "$(dirname "$0")"
export TAG="$1"
docker compose pull app worker
docker compose run --rm app bun src/migrate.ts
docker compose up -d --remove-orphans
docker image prune -f
