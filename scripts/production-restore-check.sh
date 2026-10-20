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
if [[ "${RESTORE_ERASURE_CHECKPOINT_CONFIRMED:-}" != "current-writers-paused" || "${RESTORE_TRANSPORTS_CONFIRMED:-}" != "disabled" || "${RESTORE_LEGAL_HOLDS_CONFIRMED:-}" != "current" || "${ERASURE_POLICY_APPROVED:-}" != "2026-10-15" || ! -f "${RESTORE_CURRENT_HOLDS_FILE:-}" || ! -f "${ERASURE_AGE_IDENTITY_FILE:-}" || -n "${VAPID_PRIVATE_KEY:-}" ]]; then
  echo "Restore refused: current independent erasure checkpoint, approved policy and disabled transports required." >&2
  exit 1
fi
for flag in EXTERNAL_EMAIL_ENABLED PROMOTIONAL_EXTERNAL_EMAIL_ENABLED TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED GOOGLE_WALLET_ENABLED APPLE_WALLET_ENABLED PASSFAST_ENABLED; do
  if [[ "${!flag:-}" != "false" ]]; then
    echo "Restore refused: explicitly disabled outbound transports required." >&2
    exit 1
  fi
done
if [[ "$(uname -s)" == "Darwin" ]]; then
  identity_mode="$(stat -f %Lp "$BACKUP_AGE_IDENTITY_FILE")"
else
  identity_mode="$(stat -c %a "$BACKUP_AGE_IDENTITY_FILE")"
fi
if [[ "$identity_mode" != "400" && "$identity_mode" != "600" ]]; then
  echo "Restore refused: age identity must be readable only by its owner." >&2
  exit 1
fi
for tool in pg_restore psql age aws python3; do command -v "$tool" >/dev/null || { echo "Missing restore tool: $tool" >&2; exit 1; }; done

# Bound every tool, including transport/decryption; do not forward raw database,
# object-store or age diagnostics, which can contain record values or credentials.
restore_timeout="${RESTORE_TOOL_TIMEOUT_SECONDS:-600}"
if [[ ! "$restore_timeout" =~ ^([1-9][0-9]{0,2}|1[0-7][0-9]{2}|1800)$ ]]; then
  echo "Restore refused: tool timeout must be between 1 and 1800 seconds." >&2
  exit 1
fi
run_restore_tool() {
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
        print("Restore " + stage + " timed out; diagnostics suppressed.", file=sys.stderr)
        sys.exit(1)
    if status:
        print("Restore " + stage + " failed; diagnostics suppressed.", file=sys.stderr)
        sys.exit(1)
except OSError:
    print("Restore " + stage + " could not start; diagnostics suppressed.", file=sys.stderr)
    sys.exit(1)
' "$restore_timeout" "$@"
}
export PGCONNECT_TIMEOUT=10
export PGOPTIONS="-c statement_timeout=600000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=60000"
export AWS_MAX_ATTEMPTS=3 AWS_RETRY_MODE=standard

# Use a reviewed release manifest matching the backup, including for pre-migration recovery.
# Compare complete migration content hashes/timestamps, not a hardcoded row count.
script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migration_directory="${RESTORE_MIGRATIONS_DIR:-$script_root/drizzle}"
if [[ "$migration_directory" != /* || ! -d "$migration_directory" || ! -f "$migration_directory/meta/_journal.json" ]]; then
  echo "Restore refused: reviewed absolute migration directory required." >&2
  exit 1
fi
expected_migrations="$(run_restore_tool migration-manifest python3 -c '
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
entries = json.loads((root / "meta/_journal.json").read_text())["entries"]
if not entries:
    raise ValueError("Empty migration journal")
print(",".join(hashlib.sha256((root / (entry["tag"] + ".sql")).read_bytes()).hexdigest() + ":" + str(entry["when"]) for entry in entries))
' "$migration_directory")"

export PGHOST="$RESTORE_PGHOST" PGDATABASE="$RESTORE_PGDATABASE" PGUSER="$RESTORE_PGUSER" PGPASSWORD="$RESTORE_PGPASSWORD" PGPORT="${RESTORE_PGPORT:-5432}"
# A fresh database has public plus PostgreSQL system schemas. Reject custom
# schemas (even empty ones) and every object depending on the public namespace,
# including relations, routines, types, sequences and extension-owned objects.
# Large objects have no namespace. Only the built-in plpgsql extension in
# pg_catalog is part of the fresh-database baseline; custom extensions refuse.
# Catalog metadata is not filtered by the caller's table visibility privileges.
existing="$(run_restore_tool target-metadata psql -X -At -v ON_ERROR_STOP=1 -c "
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
run_restore_tool current-legal-hold-checkpoint python3 "$script_root/scripts/erasure_manifest.py" verify-holds >/dev/null
run_restore_tool independent-erasure-checkpoint python3 "$script_root/scripts/erasure_manifest.py" verify >/dev/null
encrypted=""
decrypted=""
trap 'rm -f "$encrypted" "$decrypted"' EXIT
encrypted="$(mktemp)"
decrypted="$(mktemp)"
run_restore_tool download aws --cli-connect-timeout 10 --cli-read-timeout 60 --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "s3://$BACKUP_S3_BUCKET/$BACKUP_OBJECT_KEY" "$encrypted" --only-show-errors
run_restore_tool decryption age -d -i "$BACKUP_AGE_IDENTITY_FILE" "$encrypted" > "$decrypted"
run_restore_tool archive-validation pg_restore --list "$decrypted" >/dev/null
run_restore_tool database-restore pg_restore --single-transaction --exit-on-error --no-owner --no-acl --dbname="$PGDATABASE" "$decrypted"
schema="$(run_restore_tool schema-validation psql -X -At -v ON_ERROR_STOP=1 -c "SELECT CASE WHEN to_regclass('public.user') IS NOT NULL AND to_regclass('public.tenants') IS NOT NULL AND to_regclass('public.locations') IS NOT NULL AND to_regclass('public.memberships') IS NOT NULL AND to_regclass('public.ledger_entries') IS NOT NULL AND to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AND (SELECT count(*) FROM pg_trigger WHERE tgname = 'ledger_append_only' AND NOT tgisinternal AND tgrelid='public.ledger_entries'::regclass AND tgenabled='O' AND tgtype=27 AND tgfoid='public.reject_ledger_mutation()'::regprocedure) = 1 AND (SELECT count(*) FROM pg_constraint WHERE contype='f' AND convalidated AND ((conname='ledger_entries_tenant_id_membership_id_memberships_tenant_id_id_fk' AND conrelid='public.ledger_entries'::regclass AND confrelid='public.memberships'::regclass) OR (conname='memberships_tenant_id_program_id_programs_tenant_id_id_fk' AND conrelid='public.memberships'::regclass AND confrelid='public.programs'::regclass))) = 2 THEN 'ok' ELSE 'incomplete' END")"
[[ "$schema" == "ok" ]] || { echo "Restore schema/append-only trigger check failed." >&2; exit 1; }
actual_migrations="$(run_restore_tool migration-validation psql -X -At -v ON_ERROR_STOP=1 -c "SELECT coalesce(string_agg(hash || ':' || created_at::text, ',' ORDER BY created_at,id),'') FROM drizzle.__drizzle_migrations")"
[[ "$actual_migrations" == "$expected_migrations" ]] || { echo "Restore migration metadata does not match this release." >&2; exit 1; }
# Restore function ownership/ACLs only from the reviewed recovery checkout.
# An older backup without the additive retention schema stays quarantined;
# this script does not invent or silently apply schema upgrades.
run_restore_tool retention-authority psql -X -v ON_ERROR_STOP=1 -f "$script_root/scripts/provision-retention-roles.sql" >/dev/null
export ERASURE_ALLOW_LOCAL_ISOLATED="${RESTORE_ALLOW_LOCAL_ISOLATED:-false}"
run_restore_tool erasure-reconciliation python3 "$script_root/scripts/erasure_manifest.py" replay
balances="$(run_restore_tool balance-validation psql -X -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.memberships AS m WHERE m.balance <> coalesce((SELECT sum(l.delta) FROM public.ledger_entries AS l WHERE l.tenant_id=m.tenant_id AND l.membership_id=m.id),0)")"
[[ "$balances" == "0" ]] || { echo "Restore membership balance/ledger check failed." >&2; exit 1; }
# 0025_data_integrity_guards adds five checks NOT VALID on purpose: they bind every new or changed row, but rows written
# before 0025 were never re-checked. A restore keeps them that way; any other unvalidated constraint still fails.
constraints="$(run_restore_tool constraint-validation psql -X -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_constraint WHERE contype IN ('f','c') AND NOT convalidated AND connamespace='public'::regnamespace AND NOT (contype='c' AND (conrelid, conname) IN (('public.automation_rules'::regclass,'automation_rule_inactivity_valid'),('public.ledger_entries'::regclass,'ledger_kind_sign_valid'),('public.ledger_entries'::regclass,'ledger_reversal_link_valid'),('public.locations'::regclass,'location_coordinates_valid'),('public.redemptions'::regclass,'redemption_cost_positive')))")"
[[ "$constraints" == "0" ]] || { echo "Restore contains unvalidated constraints." >&2; exit 1; }
counts="$(run_restore_tool record-counts psql -X -At -v ON_ERROR_STOP=1 -c "SELECT 'tenants=' || (SELECT count(*) FROM tenants) || ', locations=' || (SELECT count(*) FROM locations) || ', memberships=' || (SELECT count(*) FROM memberships) || ', ledger_entries=' || (SELECT count(*) FROM ledger_entries) || ', migrations=' || (SELECT count(*) FROM drizzle.__drizzle_migrations)")"
echo "Isolated restore PASS: $counts"
