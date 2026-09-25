#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
if [ ! -f var/preview.env ]; then
  echo "Start the preview once with npm run preview before running its worker." >&2
  exit 1
fi
set -a
. ./var/preview.env
set +a
./node_modules/.bin/tsx scripts/assert-preview.ts
NODE_ENV=development ./node_modules/.bin/tsx scripts/worker.ts "$@"
