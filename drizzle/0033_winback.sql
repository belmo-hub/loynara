-- ENG-044 win-back: three programme columns (off by default) and ledger source 'winback_bonus'. The ledger check is re-added
-- NOT VALID (as 0025 and 0029): existing rows cannot violate it, so no full scan under the lock.
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_source_valid";--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "winback_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "winback_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "winback_bonus" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_source_valid" CHECK ("ledger_entries"."source" in ('staff_online','staff_offline','staff_correction','synthetic_seed','legacy_unclassified','referral_bonus','nfc_tap','welcome_bonus','happy_hour','winback_bonus')) NOT VALID;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "program_winback_valid" CHECK ("programs"."winback_days" between 14 and 90 and "programs"."winback_bonus" between 0 and (case when "programs"."type" = 'stamp' then 1 else 10000 end));--> statement-breakpoint
-- The owner switch and message kind 'almost' are for ENG-045 (the "almost there" reminder, stacked on this one), so that ticket needs no migration.
ALTER TABLE "programs" ADD COLUMN "almost_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_messages" DROP CONSTRAINT "wallet_message_kind_valid";--> statement-breakpoint
ALTER TABLE "wallet_messages" ADD CONSTRAINT "wallet_message_kind_valid" CHECK ("wallet_messages"."kind" in ('owner','winback','almost'));
