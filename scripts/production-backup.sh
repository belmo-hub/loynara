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
for tool in pg_dump psql age aws openssl python3; do command -v "$tool" >/dev/null || { echo "Missing backup tool: $tool" >&2; exit 1; }; done

# Bound every tool, including transport/encryption; do not forward raw database,
# object-store or age diagnostics, which can contain record values or credentials.
backup_timeout="${BACKUP_TOOL_TIMEOUT_SECONDS:-600}"
if [[ ! "$backup_timeout" =~ ^([1-9][0-9]{0,2}|1[0-7][0-9]{2}|1800)$ ]]; then
  echo "Backup refused: tool timeout must be between 1 and 1800 seconds." >&2
  exit 1
fi
run_backup_tool() {
  python3 -c '
import os, signal, subprocess, sys
seconds, stage, *command = sys.argv[1:]
try:
    process = subprocess.Popen(command, stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        status = process.wait(timeout=int(seconds))
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try: process.wait(timeout=2)
        except subprocess.TimeoutExpired: pass
        try: os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        process.wait()
        print("Backup " + stage + " timed out; diagnostics suppressed.", file=sys.stderr)
        sys.exit(1)
    if status:
        print("Backup " + stage + " failed; diagnostics suppressed.", file=sys.stderr)
        sys.exit(1)
except OSError:
    print("Backup " + stage + " could not start; diagnostics suppressed.", file=sys.stderr)
    sys.exit(1)
' "$backup_timeout" "$@"
}
export PGCONNECT_TIMEOUT=10
export PGOPTIONS="-c statement_timeout=600000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=60000"
export AWS_MAX_ATTEMPTS=3 AWS_RETRY_MODE=standard

encrypted="$(mktemp)"
key="loynara/$(date -u +%Y/%m/%d)/$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 6).dump.age"
if [[ "$backup_heartbeat" == https://hc-ping.com/* ]]; then
  curl --fail --silent --max-time 5 --output /dev/null "$backup_heartbeat/start" >/dev/null 2>&1 || echo "Backup monitor start signal unavailable." >&2
fi
script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
run_backup_tool independent-erasure-namespace python3 "$script_directory/erasure_manifest.py" check-namespace >/dev/null
# Any database these credentials can open would dump and upload fine, so check it is Loynara's before reporting success.
source_schema="$(run_backup_tool source-schema-check psql -X -At -v ON_ERROR_STOP=1 -c "SELECT to_regclass('public.ledger_entries') IS NOT NULL AND to_regclass('drizzle.__drizzle_migrations') IS NOT NULL" || true)"
[[ "$source_schema" == "t" ]] || { echo "Production backup refused: the configured database does not hold the Loynara schema." >&2; exit 1; }
run_backup_tool database-dump pg_dump --format=custom --no-owner --no-acl | run_backup_tool encryption age -r "$BACKUP_AGE_RECIPIENT" > "$encrypted"
[[ -s "$encrypted" ]] || { echo "Encrypted backup is empty." >&2; exit 1; }
run_backup_tool upload aws --cli-connect-timeout 10 --cli-read-timeout 60 --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$encrypted" "s3://$BACKUP_S3_BUCKET/$key" --only-show-errors
run_backup_tool upload-verification aws --cli-connect-timeout 10 --cli-read-timeout 60 --endpoint-url "$BACKUP_S3_ENDPOINT" s3api head-object --bucket "$BACKUP_S3_BUCKET" --key "$key" >/dev/null
if [[ -n "$backup_heartbeat" ]]; then
  command -v curl >/dev/null || { echo "Missing backup monitor client: curl" >&2; exit 1; }
  curl --fail --silent --max-time 5 --output /dev/null "$backup_heartbeat" >/dev/null 2>&1 || { echo "Backup uploaded but monitor heartbeat failed." >&2; exit 1; }
fi
echo "Encrypted offsite backup uploaded and HEAD-verified: $key"
