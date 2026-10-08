-- Manual rollback of migration 0021_staff_push_subscriptions. NOT run automatically and never applied to production by this
-- repository.
--
-- Effect: the database returns to the exact 0020 schema. No ledger, balance, card, tap, Wallet or staff row is touched.
-- Data that is LOST by design: the Web Push subscriptions of staff devices (cashiers simply enable notifications again
-- after a later re-upgrade) and NFC wake-up jobs that were not sent yet (pending NFC requests still appear on an open
-- cashier screen, which polls). Roll back the image together with this script: a pre-0021 worker would mark leftover
-- push jobs as an unknown kind.
--
-- Run once, inside a transaction, with the web and worker services stopped:
--   psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --single-transaction -f docs/rollback/0021-staff-push-subscriptions-down.sql

-- Fail closed BEFORE changing anything: only the paired rollback from exactly 0021.
LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE;
DO $rollback$
DECLARE
  journal_count bigint;
  final_timestamp bigint;
BEGIN
  SELECT count(*) INTO journal_count FROM drizzle.__drizzle_migrations;
  SELECT created_at INTO final_timestamp FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1;
  IF journal_count <> 22 OR final_timestamp IS DISTINCT FROM 1791417633414::bigint THEN
    RAISE EXCEPTION '0021 rollback refused: journal must contain exactly 22 entries ending at timestamp 1791417633414';
  END IF;
END
$rollback$;

DELETE FROM outbox_jobs WHERE kind = 'push.tap_pending';
DROP TABLE staff_push_subscriptions;

-- Forget that 0021 was applied; the preflight lock and timestamp guard still hold.
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)
  AND created_at = 1791417633414 AND (SELECT count(*) FROM drizzle.__drizzle_migrations) = 22;
