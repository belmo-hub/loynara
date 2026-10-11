#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
./node_modules/.bin/tsx scripts/assert-local.ts
umask 077

if [ "$#" -gt 1 ]; then
  echo "Usage: npm run backup -- [output.dump]" >&2
  exit 1
fi
output=${1:-"var/backups/looplocal-$(date -u +%Y%m%dT%H%M%SZ).dump"}
if [ -e "$output" ]; then
  echo "Backup target already exists; choose another path." >&2
  exit 1
fi
mkdir -p "$(dirname "$output")"
temporary=$(mktemp "${output}.tmp.XXXXXX")
trap 'rm -f "$temporary"' EXIT HUP INT TERM

docker compose exec -T postgres pg_dump -U looplocal -d looplocal --format=custom --no-owner --no-acl > "$temporary"
if [ ! -s "$temporary" ]; then
  echo "Backup is empty." >&2
  exit 1
fi
docker compose exec -T postgres pg_restore --list < "$temporary" >/dev/null
./node_modules/.bin/tsx scripts/publish-backup.ts "$temporary" "$output"
rm -f "$temporary"
trap - EXIT HUP INT TERM
echo "Backup written to $output"
