-- 0020: Wallet pass lifecycle. Not yet deployed anywhere. No ledger, membership or balance data is changed.
-- A wallet_passes row now stands for one issued pass/object of one card CREDENTIAL GENERATION (scan code). A reissue or
-- closure revokes the rows instead of re-pointing them, so an old pass can be voided/deactivated but never receive the
-- new QR code. Apple serial = wallet_passes.id (previously the membership id), so at most one ACTIVE row per provider.

-- The old Apple model did not retain the original authentication token after credential rotation. Silently dropping
-- its registrations would strand installed passes with an active-looking QR. Refuse this unsupported upgrade BEFORE
-- changing any schema/data; a separately reviewed legacy-pass transition is required when any Apple state exists.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM wallet_passes WHERE provider = 'apple')
    OR EXISTS (SELECT 1 FROM apple_registrations) OR EXISTS (SELECT 1 FROM apple_devices) THEN
    RAISE EXCEPTION '0020 refused: legacy Apple Wallet state requires a reviewed compatibility transition';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "wallet_passes" DROP CONSTRAINT "wallet_pass_member_provider_uq";--> statement-breakpoint
ALTER TABLE "wallet_passes" ADD COLUMN "credential_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "wallet_passes" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wallet_passes" ADD COLUMN "revoke_reason" varchar(16);--> statement-breakpoint
ALTER TABLE "wallet_passes" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wallet_passes" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

-- Legacy Google objects retain their original object IDs and are explicitly queued for deactivation. Apple state
-- was refused above. No membership credential, balance, ledger or locator is rewritten.
UPDATE "wallet_passes" SET
  "revoked_at" = now(),
  "revoke_reason" = CASE WHEN "status" = 'revocation_pending' THEN 'closed' ELSE 'superseded' END,
  "status" = 'revocation_pending';--> statement-breakpoint

INSERT INTO outbox_jobs (tenant_id, kind, payload)
SELECT DISTINCT p.tenant_id, 'wallet.refresh', jsonb_build_object('membershipId', p.membership_id::text)
FROM wallet_passes p
WHERE p.provider = 'google' AND p.status = 'revocation_pending'
  AND NOT EXISTS (SELECT 1 FROM outbox_jobs j WHERE j.tenant_id = p.tenant_id AND j.kind = 'wallet.refresh'
    AND j.status = 'pending' AND j.payload ->> 'membershipId' = p.membership_id::text);--> statement-breakpoint

-- Candidate jobs are unique under concurrent programme/card writes. Unmarked old-web jobs remain compatible while
-- the provider-disabled software rollout overlaps 0019 web/worker with 0020 schema.
CREATE UNIQUE INDEX "outbox_wallet_pending_member_idx" ON "outbox_jobs" USING btree ("tenant_id", ("payload" ->> 'membershipId')) WHERE "outbox_jobs"."kind" = 'wallet.refresh' and "outbox_jobs"."status" = 'pending' and "outbox_jobs"."payload" ->> 'coalescingVersion' = '1';--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_pass_active_member_provider_uq" ON "wallet_passes" USING btree ("membership_id","provider") WHERE "wallet_passes"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "wallet_pass_member_idx" ON "wallet_passes" USING btree ("tenant_id","membership_id");--> statement-breakpoint
ALTER TABLE "wallet_passes" ADD CONSTRAINT "wallet_pass_revoke_valid" CHECK (("wallet_passes"."revoked_at" is null and "wallet_passes"."revoke_reason" is null) or ("wallet_passes"."revoked_at" is not null and "wallet_passes"."revoke_reason" is not null and "wallet_passes"."revoke_reason" in ('reissued','closed','superseded')));
