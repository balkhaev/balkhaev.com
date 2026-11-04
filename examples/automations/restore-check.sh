#!/usr/bin/env bash
# restore-check.sh <backup file> <age private key file>
# Restores a backup into a throwaway Postgres and prints row counts.
# Run it once a month on your own machine: a backup nobody has restored is a hope, not a backup.
set -euo pipefail
backup="$1"
key="$2"
name="restore-check-$$"

docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=check postgres:18 > /dev/null
trap 'docker stop "$name" > /dev/null' EXIT
until docker exec "$name" pg_isready -U postgres > /dev/null 2>&1; do sleep 1; done

docker exec "$name" createdb -U postgres app
age -d -i "$key" "$backup" | docker exec -i "$name" pg_restore -U postgres -d app --no-owner

docker exec "$name" psql -U postgres -d app -c "
  select 'leads' as table, count(*) as rows, max(created_at) as newest from leads
  union all select 'orders', count(*), max(created_at) from orders
  union all select 'tickets', count(*), max(created_at) from tickets
  union all select 'events', count(*), max(received_at) from events"
