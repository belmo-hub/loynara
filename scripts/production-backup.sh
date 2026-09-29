#!/usr/bin/env bash
set -euo pipefail
umask 077

backup_heartbeat="${BACKUP_HEARTBEAT_URL:-}"
if [[ -n "$backup_heartbeat" && ! "$backup_heartbeat" =~ ^https://heartbeat\.uptimerobot\.com/m[A-Za-z0-9-]+$ && ! "$backup_heartbeat" =~ ^https://hc-ping\.com/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  echo "Invalid backup monitor configuration." >&2
  exit 1
fi

encrypted=""
cleanup() {
  local result=$?
  [[ -z "$encrypted" ]] || rm -f "$encrypted"
  if (( result != 0 )) && [[ "$backup_heartbeat" == https://hc-ping.com/* ]]; then
    curl --fail --silent --max-time 5 --output /dev/null "$backup_heartbeat/fail" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ "${PRODUCTION_ENVIRONMENT:-}" != "loynara-production" || "${PGHOST:-}" != *.railway.internal || -z "${PGDATABASE:-}" || -z "${PGUSER:-}" || -z "${PGPASSWORD:-}" ]]; then
  echo "Production backup refused: private production PostgreSQL configuration required." >&2
  exit 1
fi
if [[ ! "${BACKUP_S3_ENDPOINT:-}" =~ ^https://[0-9a-f]{32}\.eu\.r2\.cloudflarestorage\.com$ || -z "${BACKUP_S3_BUCKET:-}" || "${BACKUP_AGE_RECIPIENT:-}" != age1* || -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" || "${AWS_DEFAULT_REGION:-}" != auto ]]; then
  echo "Production backup refused: private EU R2 endpoint, scoped credentials and public age recipient required." >&2
  exit 1
fi
for tool in pg_dump age aws openssl; do command -v "$tool" >/dev/null || { echo "Missing backup tool: $tool" >&2; exit 1; }; done

encrypted="$(mktemp)"
key="loynara/$(date -u +%Y/%m/%d)/$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 6).dump.age"
if [[ "$backup_heartbeat" == https://hc-ping.com/* ]]; then
  curl --fail --silent --max-time 5 --output /dev/null "$backup_heartbeat/start" >/dev/null 2>&1 || echo "Backup monitor start signal unavailable." >&2
fi
pg_dump --format=custom --no-owner --no-acl | age -r "$BACKUP_AGE_RECIPIENT" > "$encrypted"
[[ -s "$encrypted" ]] || { echo "Encrypted backup is empty." >&2; exit 1; }
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$encrypted" "s3://$BACKUP_S3_BUCKET/$key" --only-show-errors
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3api head-object --bucket "$BACKUP_S3_BUCKET" --key "$key" >/dev/null
if [[ -n "$backup_heartbeat" ]]; then
  command -v curl >/dev/null || { echo "Missing backup monitor client: curl" >&2; exit 1; }
  curl --fail --silent --max-time 5 --output /dev/null "$backup_heartbeat" >/dev/null 2>&1 || { echo "Backup uploaded but monitor heartbeat failed." >&2; exit 1; }
fi
echo "Encrypted offsite backup uploaded and HEAD-verified: $key"
