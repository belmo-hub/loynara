#!/bin/sh
set -eu

# Default: the compose Postgres on 54329. A parallel worktree can point at its own disposable container instead:
#   TEST_PG_CONTAINER=loynara-product-pg TEST_PG_PORT=54391 npm test
# The database name stays looplocal_test because integration tests refuse any other name.
if [ -n "${TEST_PG_CONTAINER:-}" ]; then
  psql_exec() { docker exec -i "$TEST_PG_CONTAINER" "$@"; }
  port="${TEST_PG_PORT:?TEST_PG_PORT is required with TEST_PG_CONTAINER}"
else
  docker compose up -d postgres >/dev/null
  psql_exec() { docker compose exec -T postgres "$@"; }
  port=54329
fi
if ! psql_exec psql -U looplocal -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='looplocal_test'" | grep -q 1; then
  psql_exec createdb -U looplocal looplocal_test
fi
if ! psql_exec psql -U looplocal -d looplocal_test -Atc "SELECT to_regclass('public.user')" | grep -q user; then
  psql_exec psql -v ON_ERROR_STOP=1 -U looplocal -d looplocal_test < drizzle/auth.sql >/dev/null
fi
export DATABASE_URL="postgresql://looplocal:looplocal_local_only@localhost:${port}/looplocal_test"
npx drizzle-kit migrate >/dev/null
exec npx vitest run "$@"
