#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
if [ ! -f var/preview.env ]; then
  echo "Start the preview once with npm run preview before checking a restore." >&2
  exit 1
fi
set -a
. ./var/preview.env
set +a
./node_modules/.bin/tsx scripts/assert-preview.ts

if [ "$#" -gt 1 ]; then
  echo "Usage: npm run preview:restore-check -- [backup.dump]" >&2
  exit 1
fi
if [ "$#" -eq 1 ]; then
  backup=$1
else
  backup=$(find var/backups -maxdepth 1 -name 'preview-*.dump' -type f -print 2>/dev/null | sort | tail -n 1)
fi
if [ -z "${backup:-}" ] || [ ! -s "$backup" ]; then
  echo "No preview backup found. Run npm run preview:backup first." >&2
  exit 1
fi

docker compose -p looplocal-preview -f compose.preview.yaml exec -T postgres pg_restore --list < "$backup" >/dev/null
restore_db="looplocal_preview_restore_$(date -u +%s)_$$"
cleanup() {
  docker compose -p looplocal-preview -f compose.preview.yaml exec -T postgres dropdb -U looplocal_preview --if-exists --force "$restore_db" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

docker compose -p looplocal-preview -f compose.preview.yaml exec -T postgres createdb -U looplocal_preview "$restore_db"
docker compose -p looplocal-preview -f compose.preview.yaml exec -T postgres pg_restore -U looplocal_preview -d "$restore_db" --exit-on-error --no-owner --no-acl < "$backup"
result=$(docker compose -p looplocal-preview -f compose.preview.yaml exec -T postgres psql -v ON_ERROR_STOP=1 -U looplocal_preview -d "$restore_db" -Atc "SELECT CASE WHEN to_regclass('public.user') IS NOT NULL AND to_regclass('public.tenants') IS NOT NULL AND to_regclass('public.memberships') IS NOT NULL AND to_regclass('public.ledger_entries') IS NOT NULL AND (SELECT count(*) FROM pg_trigger WHERE tgname = 'ledger_append_only' AND NOT tgisinternal) = 1 THEN 'ok' ELSE 'incomplete' END")
if [ "$result" != "ok" ]; then
  echo "Preview restored schema is incomplete." >&2
  exit 1
fi
counts=$(docker compose -p looplocal-preview -f compose.preview.yaml exec -T postgres psql -v ON_ERROR_STOP=1 -U looplocal_preview -d "$restore_db" -Atc "SELECT 'tenants=' || (SELECT count(*) FROM tenants) || ', memberships=' || (SELECT count(*) FROM memberships) || ', ledger_entries=' || (SELECT count(*) FROM ledger_entries)")
echo "Preview restore check passed in isolated temporary database: $counts"
