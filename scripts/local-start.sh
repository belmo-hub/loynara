#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

if [ ! -x ./node_modules/.bin/tsx ]; then
  echo "Install dependencies first with npm ci." >&2
  exit 1
fi
if [ ! -f .env ] || [ ! -f .env.local ]; then
  echo "Create matching .env and .env.local from .env.example before local startup." >&2
  exit 1
fi
if ! cmp -s .env .env.local; then
  echo ".env and .env.local differ; align them so scripts and Next use one local configuration." >&2
  exit 1
fi

./node_modules/.bin/tsx scripts/assert-local.ts
docker compose up -d postgres mailpit

ready=0
attempt=0
while [ "$attempt" -lt 30 ]; do
  if docker compose exec -T postgres pg_isready -U looplocal -d looplocal >/dev/null 2>&1; then
    ready=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "Local PostgreSQL did not become ready." >&2
  exit 1
fi

if ! docker compose exec -T postgres psql -U looplocal -d looplocal -Atc "SELECT to_regclass('public.user') IS NOT NULL" | grep -qx t; then
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U looplocal -d looplocal < drizzle/auth.sql >/dev/null
fi

npm run db:migrate
npm run db:seed
npm run diagnose

./node_modules/.bin/tsx scripts/worker.ts &
worker_pid=$!
cleanup() {
  kill "$worker_pid" 2>/dev/null || true
  wait "$worker_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Local app starting at http://localhost:3000 (Mailpit: http://localhost:8026)."
./node_modules/.bin/next dev --hostname 127.0.0.1
