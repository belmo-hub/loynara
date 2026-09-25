#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
if [ ! -f var/device-test.env ] || [ -L var/device-test.env ] || [ "$(stat -f '%Lp' var/device-test.env)" != "600" ]; then
  echo "The restricted device-test environment is missing." >&2
  exit 1
fi
set -a
. ./var/device-test.env
set +a
./node_modules/.bin/tsx scripts/device-test-assert.ts --prepare
docker compose -p looplocal-device-test -f compose.device-test.yaml stop postgres
echo "Device-test PostgreSQL stopped; its isolated volume was retained. Stop the foreground web/worker launcher with Ctrl-C first."
