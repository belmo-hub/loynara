-- ENG-207: the Startbonus can be given at sign-up instead of with the first booking (HEAD_START_ENABLED, off by default).
-- Additive: one programme column with a default ('first_award' = today's behaviour), and the ledger source 'head_start',
-- which no person books (as 'nfc_tap' and 'expiry'). The two ledger checks are widened, so no existing row can break
-- them; they are re-added NOT VALID and validated here, in the same transaction. Nothing is backfilled.
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_source_valid";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_nfc_actor_valid";--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "welcome_bonus_at" varchar(12) DEFAULT 'first_award' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_source_valid" CHECK ("ledger_entries"."source" in ('staff_online','staff_offline','staff_correction','synthetic_seed','legacy_unclassified','referral_bonus','nfc_tap','welcome_bonus','happy_hour','winback_bonus','birthday_bonus','expiry','challenge_bonus','head_start')) NOT VALID;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_nfc_actor_valid" CHECK (("ledger_entries"."source" in ('nfc_tap','expiry','head_start') and "ledger_entries"."actor_user_id" is null) or ("ledger_entries"."source" not in ('nfc_tap','expiry','head_start') and "ledger_entries"."actor_user_id" is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "ledger_entries" VALIDATE CONSTRAINT "ledger_source_valid";--> statement-breakpoint
ALTER TABLE "ledger_entries" VALIDATE CONSTRAINT "ledger_nfc_actor_valid";--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "program_welcome_bonus_at_valid" CHECK ("programs"."welcome_bonus_at" in ('first_award','enrollment'));
