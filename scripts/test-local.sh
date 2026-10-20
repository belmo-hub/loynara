#!/bin/sh
set -eu

if [ "${NODE_ENV:-}" = production ]; then
  echo "Test runner refuses production mode" >&2
  exit 1
fi

# Default: the compose Postgres on 54329. A parallel worktree can point at its own disposable container instead:
#   TEST_PG_CONTAINER=loynara-product-pg TEST_PG_PORT=54391 npm test
# The database name stays looplocal_test because integration tests refuse any other name.
if [ -n "${TEST_PG_CONTAINER:-}" ]; then
  container="$TEST_PG_CONTAINER"
  port="${TEST_PG_PORT:?TEST_PG_PORT is required with TEST_PG_CONTAINER}"
else
  docker compose up -d postgres >/dev/null
  container="$(docker compose ps -q postgres)"
  port=54329
fi
export TEST_PG_PORT="$port"
TEST_PG_CONTAINER_ID="$(./node_modules/.bin/tsx scripts/test-database-guard.ts --container "$container" "$port")"
export TEST_PG_CONTAINER_ID
[ -n "$TEST_PG_CONTAINER_ID" ] || exit 1
psql_exec() { docker exec -i -e PGHOST=127.0.0.1 -e PGPORT=5432 -e PGPASSWORD=looplocal_local_only "$TEST_PG_CONTAINER_ID" "$@"; }
attempt=0
until psql_exec pg_isready -U looplocal -d postgres >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Checked synthetic PostgreSQL did not become ready" >&2
    exit 1
  fi
  sleep 1
done
TEST_PG_DATA_DIRECTORY="$(psql_exec psql -v ON_ERROR_STOP=1 -U looplocal -d postgres -Atc 'SHOW data_directory')"
export TEST_PG_DATA_DIRECTORY
export NODE_ENV=test
export DATABASE_URL="postgresql://looplocal:looplocal_local_only@localhost:${port}/looplocal_test"
export PUBLIC_BASE_URL="http://localhost:3000"
export BETTER_AUTH_URL="http://localhost:3000"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')}"
export EXTERNAL_EMAIL_ENABLED=false
# Preserve legacy fixtures that explicitly enable EXTERNAL_EMAIL_ENABLED.
# With that flag false here, an absent compatibility override keeps delivery off.
unset TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED
export PROMOTIONAL_EXTERNAL_EMAIL_ENABLED=false
export SMTP_HOST=disabled
export APPLE_WALLET_ENABLED=false
export GOOGLE_WALLET_ENABLED=false
export PASSFAST_ENABLED=false
created=no
if ! psql_exec psql -U looplocal -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='looplocal_test'" | grep -q 1; then
  psql_exec createdb -U looplocal looplocal_test
  created=yes
fi
# Suites that truncate tables or end connections only accept a database marked as disposable. Only a database this
# script just created is marked by itself; an existing one (perhaps a restored copy) only on request:
#   MARK_TEST_DATABASE_DISPOSABLE=yes npm test
if [ "$created" = yes ] || [ "${MARK_TEST_DATABASE_DISPOSABLE:-}" = yes ]; then
  psql_exec psql -U looplocal -d looplocal_test -qc "COMMENT ON DATABASE looplocal_test IS 'loynara-disposable-test-database'"
fi
if ! psql_exec psql -U looplocal -d looplocal_test -Atc "SELECT to_regclass('public.user')" | grep -q user; then
  psql_exec psql -v ON_ERROR_STOP=1 -U looplocal -d looplocal_test < drizzle/auth.sql >/dev/null
fi
npx drizzle-kit migrate >/dev/null
exec npx vitest run "$@"
