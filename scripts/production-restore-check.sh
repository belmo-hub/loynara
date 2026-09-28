#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "${RESTORE_TARGET_CONFIRMED:-}" != "isolated" || -z "${RESTORE_PGHOST:-}" || -z "${RESTORE_PGDATABASE:-}" || -z "${RESTORE_PGUSER:-}" || -z "${RESTORE_PGPASSWORD:-}" || -z "${PRODUCTION_PGHOST:-}" ]]; then
  echo "Restore refused: explicitly confirmed isolated target and production host reference required." >&2
  exit 1
fi
if [[ "$RESTORE_PGHOST" == "$PRODUCTION_PGHOST" || "$RESTORE_PGHOST" != *.railway.internal || "$RESTORE_PGDATABASE" != loynara_restore_* || "${BACKUP_S3_ENDPOINT:-}" != https://*.storageapi.dev || -z "${BACKUP_S3_BUCKET:-}" || -z "${BACKUP_OBJECT_KEY:-}" || ! -f "${BACKUP_AGE_IDENTITY_FILE:-}" ]]; then
  echo "Restore refused: target must be a separate database host with an encrypted backup and local age identity." >&2
  exit 1
fi
identity_mode="$(stat -c %a "$BACKUP_AGE_IDENTITY_FILE")"
if [[ "$identity_mode" != "400" && "$identity_mode" != "600" ]]; then
  echo "Restore refused: age identity must be readable only by its owner." >&2
  exit 1
fi
for tool in pg_restore psql age aws; do command -v "$tool" >/dev/null || { echo "Missing restore tool: $tool" >&2; exit 1; }; done

export PGHOST="$RESTORE_PGHOST" PGDATABASE="$RESTORE_PGDATABASE" PGUSER="$RESTORE_PGUSER" PGPASSWORD="$RESTORE_PGPASSWORD" PGPORT="${RESTORE_PGPORT:-5432}"
existing="$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")"
[[ "$existing" == "0" ]] || { echo "Restore target is not empty; no changes made." >&2; exit 1; }
encrypted="$(mktemp)"
decrypted="$(mktemp)"
trap 'rm -f "$encrypted" "$decrypted"' EXIT
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "s3://$BACKUP_S3_BUCKET/$BACKUP_OBJECT_KEY" "$encrypted" --only-show-errors
age -d -i "$BACKUP_AGE_IDENTITY_FILE" "$encrypted" > "$decrypted"
pg_restore --list "$decrypted" >/dev/null
pg_restore --exit-on-error --no-owner --no-acl --dbname="$PGDATABASE" "$decrypted"
schema="$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT CASE WHEN to_regclass('public.user') IS NOT NULL AND to_regclass('public.tenants') IS NOT NULL AND to_regclass('public.memberships') IS NOT NULL AND to_regclass('public.ledger_entries') IS NOT NULL AND (SELECT count(*) FROM pg_trigger WHERE tgname = 'ledger_append_only' AND NOT tgisinternal) = 1 THEN 'ok' ELSE 'incomplete' END")"
[[ "$schema" == "ok" ]] || { echo "Restore schema/append-only trigger check failed." >&2; exit 1; }
counts="$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT 'tenants=' || (SELECT count(*) FROM tenants) || ', memberships=' || (SELECT count(*) FROM memberships) || ', ledger_entries=' || (SELECT count(*) FROM ledger_entries)")"
echo "Isolated restore PASS: $counts"
