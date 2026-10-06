-- 0020: Wallet pass lifecycle. Not yet deployed anywhere. No ledger, membership or balance data is changed.
-- A wallet_passes row now stands for one issued pass/object of one card CREDENTIAL GENERATION (scan code). A reissue or
-- closure revokes the rows instead of re-pointing them, so an old pass can be voided/deactivated but never receive the
-- new QR code. Apple serial = wallet_passes.id (previously the membership id), so at most one ACTIVE row per provider.

ALTER TABLE "wallet_passes" DROP CONSTRAINT "wallet_pass_member_provider_uq";--> statement-breakpoint
ALTER TABLE "wallet_passes" ADD COLUMN "credential_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "wallet_passes" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wallet_passes" ADD COLUMN "revoke_reason" varchar(16);--> statement-breakpoint
ALTER TABLE "wallet_passes" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wallet_passes" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

-- Legacy rows (issued before 0020; production Wallet was never enabled, so only device-test databases can hold any) used
-- the membership id as Apple serial and a scan-code-bound token. They cannot be represented in the new model: retire
-- them. Google legacy objects stay revocation_pending so the next refresh deactivates them at Google; Apple legacy passes
-- cannot authenticate against the new web service, so their registrations are dropped and the rows are closed out.
UPDATE "wallet_passes" SET
  "revoked_at" = now(),
  "revoke_reason" = CASE WHEN "status" = 'revocation_pending' THEN 'closed' ELSE 'superseded' END,
  "status" = CASE WHEN "provider" = 'google' THEN 'revocation_pending' ELSE 'revoked' END;--> statement-breakpoint
DELETE FROM "apple_registrations";--> statement-breakpoint
DELETE FROM "apple_devices";--> statement-breakpoint

CREATE INDEX "outbox_wallet_pending_member_idx" ON "outbox_jobs" USING btree (("payload" ->> 'membershipId')) WHERE "outbox_jobs"."kind" = 'wallet.refresh' and "outbox_jobs"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_pass_active_member_provider_uq" ON "wallet_passes" USING btree ("membership_id","provider") WHERE "wallet_passes"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "wallet_pass_member_idx" ON "wallet_passes" USING btree ("tenant_id","membership_id");--> statement-breakpoint
ALTER TABLE "wallet_passes" ADD CONSTRAINT "wallet_pass_revoke_valid" CHECK (("wallet_passes"."revoked_at" is null and "wallet_passes"."revoke_reason" is null) or ("wallet_passes"."revoked_at" is not null and "wallet_passes"."revoke_reason" in ('reissued','closed','superseded')));
