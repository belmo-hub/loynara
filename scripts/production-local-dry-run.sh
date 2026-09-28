#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${NODE_ENV:-development}" == "production" ]]; then
  echo "Local migration dry run refuses production mode." >&2
  exit 1
fi
set -a
. ./.env
set +a
./node_modules/.bin/tsx scripts/assert-local.ts
database="looplocal_gate1_dryrun_$$"
cleanup() { docker compose exec -T postgres dropdb -U looplocal --if-exists --force "$database" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
docker compose exec -T postgres createdb -U looplocal "$database"
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U looplocal -d "$database" < drizzle/auth.sql >/dev/null
export DATABASE_URL="${DATABASE_URL%/*}/$database"
npm run db:migrate
result="$(docker compose exec -T postgres psql -U looplocal -d "$database" -Atc "SELECT CASE WHEN to_regclass('public.user') IS NOT NULL AND to_regclass('public.tenants') IS NOT NULL AND to_regclass('public.ledger_entries') IS NOT NULL AND (SELECT count(*) FROM pg_trigger WHERE tgname = 'ledger_append_only' AND NOT tgisinternal) = 1 AND (SELECT count(*) FROM tenants) = 0 THEN 'ok' ELSE 'incomplete' END")"
[[ "$result" == "ok" ]] || { echo "Fresh database migration verification failed." >&2; exit 1; }
NODE_ENV=development npm run worker -- --once
echo "Fresh isolated PostgreSQL migration and one-pass worker PASS; database will be removed."
