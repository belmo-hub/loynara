#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
./node_modules/.bin/tsx scripts/assert-local.ts

if [ "$#" -gt 1 ]; then
  echo "Usage: npm run restore-check -- [backup.dump]" >&2
  exit 1
fi
if [ "$#" -eq 1 ]; then
  backup=$1
else
  backup=$(find var/backups -maxdepth 1 -name 'looplocal-*.dump' -type f -print 2>/dev/null | sort | tail -n 1)
fi
if [ -z "${backup:-}" ] || [ ! -s "$backup" ]; then
  echo "No local backup found. Run npm run backup first." >&2
  exit 1
fi

docker compose exec -T postgres pg_restore --list < "$backup" >/dev/null
restore_db="looplocal_restore_$(date -u +%s)_$$"
cleanup() {
  docker compose exec -T postgres dropdb -U looplocal --if-exists --force "$restore_db" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

docker compose exec -T postgres createdb -U looplocal "$restore_db"
docker compose exec -T postgres pg_restore -U looplocal -d "$restore_db" --exit-on-error --no-owner --no-acl < "$backup"
result=$(docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U looplocal -d "$restore_db" -Atc "SELECT CASE WHEN to_regclass('public.user') IS NOT NULL AND to_regclass('public.tenants') IS NOT NULL AND to_regclass('public.memberships') IS NOT NULL AND to_regclass('public.ledger_entries') IS NOT NULL AND (SELECT count(*) FROM pg_trigger WHERE tgname = 'ledger_append_only' AND NOT tgisinternal) = 1 THEN 'ok' ELSE 'incomplete' END")
if [ "$result" != "ok" ]; then
  echo "Restored schema is incomplete." >&2
  exit 1
fi
counts=$(docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U looplocal -d "$restore_db" -Atc "SELECT 'tenants=' || (SELECT count(*) FROM tenants) || ', memberships=' || (SELECT count(*) FROM memberships) || ', ledger_entries=' || (SELECT count(*) FROM ledger_entries)")
echo "Restore check passed in isolated temporary database: $counts"
