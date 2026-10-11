#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "${RESTORE_TARGET_CONFIRMED:-}" != "isolated" || -z "${RESTORE_PGHOST:-}" || -z "${RESTORE_PGDATABASE:-}" || -z "${RESTORE_PGUSER:-}" || -z "${RESTORE_PGPASSWORD:-}" || -z "${PRODUCTION_PGHOST:-}" ]]; then
  echo "Restore refused: explicitly confirmed isolated target and production host reference required." >&2
  exit 1
fi
isolated_local=false
if [[ "$RESTORE_PGHOST" == "127.0.0.1" && "${RESTORE_ALLOW_LOCAL_ISOLATED:-}" == "true" && "${RESTORE_PGPORT:-}" =~ ^[0-9]+$ && "${RESTORE_PGPORT:-}" != "5432" && "$PRODUCTION_PGHOST" == *.railway.internal ]]; then
  isolated_local=true
fi
if [[ "$RESTORE_PGHOST" == "$PRODUCTION_PGHOST" || ( "$RESTORE_PGHOST" != *.railway.internal && "$isolated_local" != true ) || "$RESTORE_PGDATABASE" != loynara_restore_* || ! "${BACKUP_S3_ENDPOINT:-}" =~ ^https://[0-9a-f]{32}\.eu\.r2\.cloudflarestorage\.com$ || -z "${BACKUP_S3_BUCKET:-}" || -z "${BACKUP_OBJECT_KEY:-}" || -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" || "${AWS_DEFAULT_REGION:-}" != auto || ! -f "${BACKUP_AGE_IDENTITY_FILE:-}" ]]; then
  echo "Restore refused: target must be a separate database host with an encrypted backup and local age identity." >&2
  exit 1
fi
if [[ "$(uname -s)" == "Darwin" ]]; then
  identity_mode="$(stat -f %Lp "$BACKUP_AGE_IDENTITY_FILE")"
else
  identity_mode="$(stat -c %a "$BACKUP_AGE_IDENTITY_FILE")"
fi
if [[ "$identity_mode" != "400" && "$identity_mode" != "600" ]]; then
  echo "Restore refused: age identity must be readable only by its owner." >&2
  exit 1
fi
for tool in pg_restore psql age aws; do command -v "$tool" >/dev/null || { echo "Missing restore tool: $tool" >&2; exit 1; }; done

export PGHOST="$RESTORE_PGHOST" PGDATABASE="$RESTORE_PGDATABASE" PGUSER="$RESTORE_PGUSER" PGPASSWORD="$RESTORE_PGPASSWORD" PGPORT="${RESTORE_PGPORT:-5432}"
# A fresh database has public plus PostgreSQL system schemas. Reject custom
# schemas (even empty ones) and every object depending on the public namespace,
# including relations, routines, types, sequences and extension-owned objects.
# Large objects have no namespace. Only the built-in plpgsql extension in
# pg_catalog is part of the fresh-database baseline; custom extensions refuse.
# Catalog metadata is not filtered by the caller's table visibility privileges.
existing="$(psql -X -At -v ON_ERROR_STOP=1 -c "
SELECT
  (SELECT count(*) FROM pg_catalog.pg_namespace
   WHERE nspname NOT IN ('public', 'pg_catalog', 'information_schema')
     AND nspname NOT LIKE 'pg_toast%')
  +
  (SELECT count(*) FROM pg_catalog.pg_depend AS dependency
   JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = dependency.refobjid
   WHERE dependency.refclassid = 'pg_catalog.pg_namespace'::regclass
     AND namespace.nspname = 'public')
  + (SELECT count(*) FROM pg_catalog.pg_largeobject_metadata)
  + (SELECT count(*) FROM pg_catalog.pg_extension
     WHERE extname <> 'plpgsql'
        OR extnamespace <> 'pg_catalog'::regnamespace)")"
[[ "$existing" == "0" ]] || { echo "Restore target is not empty; no changes made." >&2; exit 1; }
encrypted="$(mktemp)"
decrypted="$(mktemp)"
trap 'rm -f "$encrypted" "$decrypted"' EXIT
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "s3://$BACKUP_S3_BUCKET/$BACKUP_OBJECT_KEY" "$encrypted" --only-show-errors
age -d -i "$BACKUP_AGE_IDENTITY_FILE" "$encrypted" > "$decrypted"
pg_restore --list "$decrypted" >/dev/null
pg_restore --exit-on-error --no-owner --no-acl --dbname="$PGDATABASE" "$decrypted"
schema="$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT CASE WHEN to_regclass('public.user') IS NOT NULL AND to_regclass('public.tenants') IS NOT NULL AND to_regclass('public.locations') IS NOT NULL AND to_regclass('public.memberships') IS NOT NULL AND to_regclass('public.ledger_entries') IS NOT NULL AND to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AND (SELECT count(*) FROM pg_trigger WHERE tgname = 'ledger_append_only' AND NOT tgisinternal) = 1 AND (SELECT count(*) FROM pg_constraint WHERE conname IN ('ledger_entries_tenant_id_membership_id_memberships_tenant_id_id_fk','memberships_tenant_id_program_id_programs_tenant_id_id_fk')) = 2 THEN 'ok' ELSE 'incomplete' END")"
[[ "$schema" == "ok" ]] || { echo "Restore schema/append-only trigger check failed." >&2; exit 1; }
counts="$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT 'tenants=' || (SELECT count(*) FROM tenants) || ', locations=' || (SELECT count(*) FROM locations) || ', memberships=' || (SELECT count(*) FROM memberships) || ', ledger_entries=' || (SELECT count(*) FROM ledger_entries) || ', migrations=' || (SELECT count(*) FROM drizzle.__drizzle_migrations)")"
echo "Isolated restore PASS: $counts"
