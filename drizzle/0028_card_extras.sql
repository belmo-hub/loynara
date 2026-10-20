-- ledger_source_valid gains 'welcome_bonus'. Re-added NOT VALID and then validated, as 0025 does for ledger checks.
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_source_valid";--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "welcome_bonus" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "card_news" varchar(140) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "review_url" varchar(500);--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_source_valid" CHECK ("ledger_entries"."source" in ('staff_online','staff_offline','staff_correction','synthetic_seed','legacy_unclassified','referral_bonus','nfc_tap','welcome_bonus')) NOT VALID;--> statement-breakpoint
ALTER TABLE "ledger_entries" VALIDATE CONSTRAINT "ledger_source_valid";--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "program_welcome_bonus_valid" CHECK ("programs"."welcome_bonus" between 0 and (case when "programs"."type" = 'stamp' then 3 else 50 end));