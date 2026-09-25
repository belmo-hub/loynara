#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
umask 077
if [ ! -f var/device-test.env ] || [ -L var/device-test.env ] || [ "$(stat -f '%Lp' var/device-test.env)" != "600" ]; then
  echo "Prepare a regular mode-0600 var/device-test.env first." >&2
  exit 1
fi
set -a
. ./var/device-test.env
set +a
export NEXT_TELEMETRY_DISABLED=1
./node_modules/.bin/tsx scripts/device-test-assert.ts --runtime

# Migrations are repeatable. Preparation does not seed accounts; its build-only
# artifact is discarded by the approved-origin rebuild below.
sh scripts/device-test-prepare.sh --database-only
LOOPLOCAL_DEVICE_TEST_SEED=true NODE_ENV=development ./node_modules/.bin/tsx scripts/seed.ts
npm run build

NODE_ENV=development ./node_modules/.bin/tsx scripts/worker.ts &
worker_pid=$!
cleanup() {
  kill "$worker_pid" 2>/dev/null || true
  wait "$worker_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Compiled synthetic device-test app listening only on 127.0.0.1:3002; an approved protected tunnel is a separate step."
NODE_ENV=production ./node_modules/.bin/next start --hostname 127.0.0.1 --port 3002
