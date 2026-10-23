-- Happy hour: two programme columns, ledger source 'happy_hour'. The ledger check is re-added NOT VALID (as 0025): existing rows
-- cannot violate it, so no full scan under the lock. The generator also wanted to re-create plate_link_action_valid; the
-- database already has the 'revoke' version from 0026, only the old snapshot was stale, so that pair is left out.
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_source_valid";--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "happy_hour_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "happy_hour_windows" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_source_valid" CHECK ("ledger_entries"."source" in ('staff_online','staff_offline','staff_correction','synthetic_seed','legacy_unclassified','referral_bonus','nfc_tap','welcome_bonus','happy_hour')) NOT VALID;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "program_happy_hour_valid" CHECK (jsonb_typeof("programs"."happy_hour_windows") = 'array' and jsonb_array_length("programs"."happy_hour_windows") <= 3 and (not "programs"."happy_hour_enabled" or jsonb_array_length("programs"."happy_hour_windows") > 0));