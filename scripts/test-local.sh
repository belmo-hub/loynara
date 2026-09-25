#!/bin/sh
set -eu

docker compose up -d postgres >/dev/null
if ! docker compose exec -T postgres psql -U looplocal -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='looplocal_test'" | grep -q 1; then
  docker compose exec -T postgres createdb -U looplocal looplocal_test
fi
if ! docker compose exec -T postgres psql -U looplocal -d looplocal_test -Atc "SELECT to_regclass('public.user')" | grep -q user; then
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U looplocal -d looplocal_test < drizzle/auth.sql >/dev/null
fi
export DATABASE_URL=postgresql://looplocal:looplocal_local_only@localhost:54329/looplocal_test
npx drizzle-kit migrate >/dev/null
exec npx vitest run "$@"
