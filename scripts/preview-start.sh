#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
umask 077

if [ ! -x ./node_modules/.bin/tsx ]; then
  echo "Install dependencies first with npm ci." >&2
  exit 1
fi
if [ ! -f var/preview.env ]; then
  mkdir -p var
  preview_secret=$(openssl rand -hex 32)
  cat > var/preview.env <<EOF
DATABASE_URL=postgresql://looplocal_preview:looplocal_preview_local_only@127.0.0.1:54330/looplocal_preview
BETTER_AUTH_URL=http://localhost:3001
BETTER_AUTH_SECRET=$preview_secret
PUBLIC_BASE_URL=http://localhost:3001
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
fi
if [ "$(stat -f '%Lp' var/preview.env)" != "600" ]; then
  echo "Set var/preview.env mode to 0600 before preview startup." >&2
  exit 1
fi

set -a
. ./var/preview.env
set +a
export NEXT_TELEMETRY_DISABLED=1
./node_modules/.bin/tsx scripts/assert-preview.ts

docker compose -p looplocal-preview -f compose.preview.yaml up -d postgres
ready=0
attempt=0
while [ "$attempt" -lt 30 ]; do
  if docker compose -p looplocal-preview -f compose.preview.yaml exec -T postgres pg_isready -U looplocal_preview -d looplocal_preview >/dev/null 2>&1; then
    ready=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "Preview PostgreSQL did not become ready." >&2
  exit 1
fi

if ! docker compose -p looplocal-preview -f compose.preview.yaml exec -T postgres psql -U looplocal_preview -d looplocal_preview -Atc "SELECT to_regclass('public.user') IS NOT NULL" | grep -qx t; then
  docker compose -p looplocal-preview -f compose.preview.yaml exec -T postgres psql -v ON_ERROR_STOP=1 -U looplocal_preview -d looplocal_preview < drizzle/auth.sql >/dev/null
fi
npm run db:migrate
LOOPLOCAL_PREVIEW_SEED=true ./node_modules/.bin/tsx scripts/seed.ts
npm run build

NODE_ENV=development ./node_modules/.bin/tsx scripts/worker.ts &
worker_pid=$!
cleanup() {
  kill "$worker_pid" 2>/dev/null || true
  wait "$worker_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Compiled local preview starting at http://localhost:3001 with isolated synthetic PostgreSQL."
NODE_ENV=production ./node_modules/.bin/next start --hostname 127.0.0.1 --port 3001
