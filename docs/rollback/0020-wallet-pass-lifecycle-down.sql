-- Manual rollback of migration 0020_wallet_pass_lifecycle. NOT run automatically and never applied to production by this
-- repository.
--
-- Effect: the database returns to the exact 0019 schema. No ledger, balance, card, referral or staff row is touched.
-- Data that is LOST by design: every REVOKED Wallet pass row (reissued or closed cards) and the revocation, credential and
-- sync columns of the remaining rows. Google objects that were still waiting for deactivation (revocation_pending) are no
-- longer tracked; deactivate them at Google by hand first if any exist:
--   SELECT provider_object_id FROM wallet_passes WHERE provider = 'google' AND status = 'revocation_pending';
-- Apple registrations of revoked passes are removed with them. The pre-0020 application cannot authenticate passes issued
-- by the 0020 application (serial and token model changed), so ROLL BACK THE IMAGE TOGETHER WITH THIS SCRIPT and expect
-- customers to add their Wallet pass again.
--
-- Run once, inside a transaction, with the web and worker services stopped:
--   psql "$DATABASE_URL" --single-transaction -f docs/rollback/0020-wallet-pass-lifecycle-down.sql

DELETE FROM apple_registrations r WHERE NOT EXISTS (
  SELECT 1 FROM wallet_passes p WHERE p.provider = 'apple' AND p.revoked_at IS NULL AND p.id::text = r.serial_number);
DELETE FROM apple_devices d WHERE NOT EXISTS (SELECT 1 FROM apple_registrations r WHERE r.device_library_identifier = d.device_library_identifier);
DELETE FROM wallet_passes WHERE revoked_at IS NOT NULL;

DROP INDEX outbox_wallet_pending_member_idx;
DROP INDEX wallet_pass_member_idx;
DROP INDEX wallet_pass_active_member_provider_uq;
ALTER TABLE wallet_passes DROP CONSTRAINT wallet_pass_revoke_valid;
ALTER TABLE wallet_passes DROP COLUMN created_at;
ALTER TABLE wallet_passes DROP COLUMN synced_at;
ALTER TABLE wallet_passes DROP COLUMN revoke_reason;
ALTER TABLE wallet_passes DROP COLUMN revoked_at;
ALTER TABLE wallet_passes DROP COLUMN credential_hash;
ALTER TABLE wallet_passes ADD CONSTRAINT wallet_pass_member_provider_uq UNIQUE (membership_id, provider);

-- Forget that 0020 was applied (guard: only if the newest bookkeeping row is 0020's).
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)
  AND (SELECT count(*) FROM drizzle.__drizzle_migrations) = 21;
