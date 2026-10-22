-- Points expiry (ENG-051): two programme columns, ledger kind and source 'expiry' (booked by the worker, no actor), and the
-- Wallet reminder kind 'expiry'. Ledger and message checks are re-added NOT VALID (as 0025/0029): existing rows cannot
-- violate the widened checks, so no full scan under the lock. Nothing is backfilled; expiry stays off for every programme.
-- IF EXISTS on wallet_messages only so this file applies without 0031 (scripts/production-migrate-guard leaves the
-- previous migration out on purpose); in every real order 0031 has created the table.
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_kind_valid";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_kind_sign_valid";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_source_valid";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_nfc_actor_valid";--> statement-breakpoint
ALTER TABLE IF EXISTS "wallet_messages" DROP CONSTRAINT "wallet_message_kind_valid";--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "points_expiry_months" integer;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "points_expiry_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_expiry_source_valid" CHECK (("ledger_entries"."kind" = 'expiry') = ("ledger_entries"."source" = 'expiry')) NOT VALID;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_kind_valid" CHECK ("ledger_entries"."kind" in ('award','redeem','reversal','expiry')) NOT VALID;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_kind_sign_valid" CHECK (("ledger_entries"."kind" = 'award' and "ledger_entries"."delta" > 0) or ("ledger_entries"."kind" in ('redeem','expiry') and "ledger_entries"."delta" < 0) or "ledger_entries"."kind" = 'reversal') NOT VALID;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_source_valid" CHECK ("ledger_entries"."source" in ('staff_online','staff_offline','staff_correction','synthetic_seed','legacy_unclassified','referral_bonus','nfc_tap','welcome_bonus','happy_hour','expiry')) NOT VALID;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_nfc_actor_valid" CHECK (("ledger_entries"."source" in ('nfc_tap','expiry') and "ledger_entries"."actor_user_id" is null) or ("ledger_entries"."source" not in ('nfc_tap','expiry') and "ledger_entries"."actor_user_id" is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "program_points_expiry_valid" CHECK (("programs"."points_expiry_months" is null) = ("programs"."points_expiry_since" is null) and ("programs"."points_expiry_months" is null or ("programs"."points_expiry_months" in (24,36) and "programs"."type" = 'points')));--> statement-breakpoint
ALTER TABLE IF EXISTS "wallet_messages" ADD CONSTRAINT "wallet_message_kind_valid" CHECK ("wallet_messages"."kind" in ('owner','winback','expiry')) NOT VALID;