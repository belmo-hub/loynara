#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
if [ ! -f var/device-test.env ] || [ -L var/device-test.env ] || [ "$(stat -f '%Lp' var/device-test.env)" != "600" ]; then
  echo "Prepare a regular mode-0600 var/device-test.env first." >&2
  exit 1
fi
set -a
. ./var/device-test.env
set +a
./node_modules/.bin/tsx scripts/device-test-assert.ts --runtime
NODE_ENV=development ./node_modules/.bin/tsx scripts/worker.ts "$@"
