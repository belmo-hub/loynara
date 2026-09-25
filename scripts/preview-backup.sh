#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
if [ ! -f var/preview.env ]; then
  echo "Start the preview once with npm run preview before backing it up." >&2
  exit 1
fi
set -a
. ./var/preview.env
set +a
./node_modules/.bin/tsx scripts/assert-preview.ts
umask 077

if [ "$#" -gt 1 ]; then
  echo "Usage: npm run preview:backup -- [output.dump]" >&2
  exit 1
fi
output=${1:-"var/backups/preview-$(date -u +%Y%m%dT%H%M%SZ).dump"}
if [ -e "$output" ]; then
  echo "Backup target already exists; choose another path." >&2
  exit 1
fi
mkdir -p "$(dirname "$output")"
temporary=$(mktemp "${output}.tmp.XXXXXX")
trap 'rm -f "$temporary"' EXIT HUP INT TERM

docker compose -p looplocal-preview -f compose.preview.yaml exec -T postgres pg_dump -U looplocal_preview -d looplocal_preview --format=custom --no-owner --no-acl > "$temporary"
if [ ! -s "$temporary" ]; then
  echo "Preview backup is empty." >&2
  exit 1
fi
docker compose -p looplocal-preview -f compose.preview.yaml exec -T postgres pg_restore --list < "$temporary" >/dev/null
mv "$temporary" "$output"
trap - EXIT HUP INT TERM
echo "Preview backup written to $output"
