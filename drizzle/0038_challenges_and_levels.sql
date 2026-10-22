-- Slot 0038. The ledger-source list below is the union of every earlier migration (happy hour, win-back, birthday, expiry) plus challenge_bonus.
-- Monthly challenges (ENG-052) and customer levels (ENG-053) share this migration (fixed slot 0038 for both; numbered
-- 0033 on this base until the in-order rebase). Programme columns: challenge off, levels off, no level thresholds until
-- the owner picks them; ledger source 'challenge_bonus'. The ledger check is re-added NOT VALID (as 0025/0029/0032):
-- existing rows cannot violate the widened check. Nothing is backfilled.
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_source_valid";--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "challenge_visits" integer;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "challenge_bonus" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "levels_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "level_silver_visits" integer;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "level_gold_visits" integer;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "level_bronze_perk" varchar(60) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "level_silver_perk" varchar(60) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "level_gold_perk" varchar(60) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_source_valid" CHECK ("ledger_entries"."source" in ('staff_online','staff_offline','staff_correction','synthetic_seed','legacy_unclassified','referral_bonus','nfc_tap','welcome_bonus','happy_hour','winback_bonus','birthday_bonus','expiry','challenge_bonus')) NOT VALID;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "program_challenge_valid" CHECK ("programs"."challenge_visits" is null or ("programs"."challenge_visits" between 2 and 10 and "programs"."challenge_bonus" between 1 and (case when "programs"."type" = 'stamp' then 3 else 25000 end)));--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "program_levels_valid" CHECK ((not "programs"."levels_enabled" or ("programs"."level_silver_visits" is not null and "programs"."level_gold_visits" is not null)) and ("programs"."level_silver_visits" is null or "programs"."level_silver_visits" between 2 and 50) and ("programs"."level_gold_visits" is null or ("programs"."level_gold_visits" <= 90 and ("programs"."level_silver_visits" is null or "programs"."level_gold_visits" > "programs"."level_silver_visits"))));