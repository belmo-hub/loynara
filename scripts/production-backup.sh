#!/usr/bin/env bash
set -euo pipefail
umask 077

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
trap 'rm -f "$encrypted"' EXIT
key="loynara/$(date -u +%Y/%m/%d)/$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 6).dump.age"
pg_dump --format=custom --no-owner --no-acl | age -r "$BACKUP_AGE_RECIPIENT" > "$encrypted"
[[ -s "$encrypted" ]] || { echo "Encrypted backup is empty." >&2; exit 1; }
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$encrypted" "s3://$BACKUP_S3_BUCKET/$key" --only-show-errors
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3api head-object --bucket "$BACKUP_S3_BUCKET" --key "$key" >/dev/null
if [[ -n "${BACKUP_HEARTBEAT_URL:-}" ]]; then
  command -v curl >/dev/null || { echo "Missing backup monitor client: curl" >&2; exit 1; }
  [[ "$BACKUP_HEARTBEAT_URL" == https://heartbeat.uptimerobot.com/m* ]] || { echo "Invalid backup monitor configuration." >&2; exit 1; }
  curl --fail --silent --show-error --max-time 5 --output /dev/null "$BACKUP_HEARTBEAT_URL" || echo "Backup uploaded but monitor heartbeat failed." >&2
fi
echo "Encrypted offsite backup uploaded and HEAD-verified: $key"
