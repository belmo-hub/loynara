#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
umask 077
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--database-only" ]; }; then
  echo "Usage: npm run device-test:prepare" >&2
  exit 2
fi

if [ ! -x ./node_modules/.bin/tsx ]; then
  echo "Install dependencies first with npm ci." >&2
  exit 1
fi
if [ -L var/device-test.env ]; then
  echo "Device-test configuration must be a regular local file, not a symlink." >&2
  exit 1
fi
if [ ! -f var/device-test.env ]; then
  if docker volume inspect looplocal-device-test_device_test_pg >/dev/null 2>&1; then
    echo "The device-test database volume already exists but its credentials file is missing. Inspect locally before continuing." >&2
    exit 1
  fi
  mkdir -p var
  device_db_password=$(openssl rand -hex 32)
  device_auth_secret=$(openssl rand -hex 32)
  temporary=$(mktemp var/device-test.env.tmp.XXXXXX)
  trap 'rm -f "$temporary"' EXIT HUP INT TERM
  cat > "$temporary" <<EOF
DEVICE_TEST_DB_PASSWORD=$device_db_password
DATABASE_URL=postgresql://looplocal_device:$device_db_password@127.0.0.1:54331/looplocal_device_test
BETTER_AUTH_SECRET=$device_auth_secret
BETTER_AUTH_URL=
PUBLIC_BASE_URL=
DEVICE_TEST_APPROVED_ORIGIN=
DEVICE_TEST_ACCESS_TEAM=
DEVICE_TEST_ACCESS_AUD=
LOOPLOCAL_NEXT_DIST_DIR=.next-device-test
PUBLIC_REGISTRATION_ENABLED=false
EXTERNAL_EMAIL_ENABLED=false
LIVE_BILLING_ENABLED=false
APPLE_WALLET_ENABLED=false
GOOGLE_WALLET_ENABLED=false
TRUST_PROXY_CLIENT_IP=false
SMTP_HOST=disabled
DEFAULT_CURRENCY=EUR
DEFAULT_LOCALE=de
NEXT_PUBLIC_DRAFT_EUR_PRICE_MINOR=4900
DRAFT_MAD_PRICE_MINOR=39700
EOF
  mv "$temporary" var/device-test.env
  trap - EXIT HUP INT TERM
fi
if [ "$(stat -f '%Lp' var/device-test.env)" != "600" ]; then
  echo "Set var/device-test.env mode to 0600 before preparing the device test." >&2
  exit 1
fi

set -a
. ./var/device-test.env
set +a
export NEXT_TELEMETRY_DISABLED=1
./node_modules/.bin/tsx scripts/device-test-assert.ts --prepare

docker compose -p looplocal-device-test -f compose.device-test.yaml up -d postgres
ready=0
attempt=0
while [ "$attempt" -lt 30 ]; do
  if docker compose -p looplocal-device-test -f compose.device-test.yaml exec -T postgres pg_isready -U looplocal_device -d looplocal_device_test >/dev/null 2>&1; then
    ready=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "Device-test PostgreSQL did not become ready." >&2
  exit 1
fi

if ! docker compose -p looplocal-device-test -f compose.device-test.yaml exec -T postgres psql -U looplocal_device -d looplocal_device_test -Atc "SELECT to_regclass('public.user') IS NOT NULL" | grep -qx t; then
  docker compose -p looplocal-device-test -f compose.device-test.yaml exec -T postgres psql -v ON_ERROR_STOP=1 -U looplocal_device -d looplocal_device_test < drizzle/auth.sql >/dev/null
fi
npm run db:migrate
if [ "${1:-}" != "--database-only" ]; then
  # This is only a compile and one-pass worker smoke. With no approved origin,
  # the artifact is non-runnable through the guarded device-test launcher.
  # Startup always rebuilds with the approved HTTPS origin.
  npm run build
  NODE_ENV=development ./node_modules/.bin/tsx scripts/worker.ts --once
  echo "Separate device-test DB, secrets and build-only artifact are prepared. HTTPS origin and Access settings remain required before runtime startup."
else
  echo "Separate synthetic device-test database and restricted secrets are prepared."
fi
