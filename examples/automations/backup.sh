#!/usr/bin/env bash
# backup.sh: an encrypted database dump to object storage in another place.
# Runs from cron on the server, for example every night at 03:30:
#   30 3 * * * /opt/automations/backup.sh >> /var/log/automations-backup.log 2>&1
set -euo pipefail # pipefail: a failed pg_dump must fail the script, not upload an empty file
cd "$(dirname "$0")"
source ./backup.env

# If anything below fails, tell Healthchecks right away instead of waiting for silence
trap 'curl -fsS -m 10 --retry 3 "$BACKUP_PING_URL/fail" > /dev/null || true' ERR

name="app-$(date +%Y-%m-%d-%H%M).dump.age"
file="$(mktemp)"
trap 'rm -f "$file"' EXIT

# Custom format is compressed, and pg_restore can restore a single table from it.
# age encrypts with the public key: the private key never lives on this server.
docker compose exec -T db pg_dump -U app -Fc app | age -r "$BACKUP_RECIPIENT" > "$file"

# Refuse to upload something suspiciously small: a dump of a live database is never 1 KB
size=$(stat -c %s "$file")
if [ "$size" -lt 1024 ]; then
  echo "backup is only $size bytes, not uploading" >&2
  false
fi

rclone copyto "$file" "backup:$BACKUP_BUCKET/automations/$name"
echo "$(date -Is) uploaded $name ($size bytes)"

curl -fsS -m 10 --retry 3 "$BACKUP_PING_URL" > /dev/null
