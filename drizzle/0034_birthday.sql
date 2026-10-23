-- ENG-049 birthday bonus (fixed slot 0034): the optional birthday in its own table (day and month, no year), two programme
-- columns (off by default), ledger source 'birthday_bonus' (check re-added NOT VALID as in 0025 and 0029), message kind 'birthday'.
CREATE TABLE "card_birthdays" (
	"membership_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"day" integer NOT NULL,
	"month" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_birthday_valid" CHECK ("card_birthdays"."month" between 1 and 12 and "card_birthdays"."day" between 1 and (case when "card_birthdays"."month" = 2 then 29 when "card_birthdays"."month" in (4,6,9,11) then 30 else 31 end))
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_source_valid";--> statement-breakpoint
ALTER TABLE "wallet_messages" DROP CONSTRAINT "wallet_message_kind_valid";--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "birthday_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "birthday_bonus" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "card_birthdays" ADD CONSTRAINT "card_birthdays_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_source_valid" CHECK ("ledger_entries"."source" in ('staff_online','staff_offline','staff_correction','synthetic_seed','legacy_unclassified','referral_bonus','nfc_tap','welcome_bonus','happy_hour','winback_bonus','birthday_bonus')) NOT VALID;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "program_birthday_bonus_valid" CHECK ("programs"."birthday_bonus" between 0 and (case when "programs"."type" = 'stamp' then 1 else 10000 end));--> statement-breakpoint
ALTER TABLE "wallet_messages" ADD CONSTRAINT "wallet_message_kind_valid" CHECK ("wallet_messages"."kind" in ('owner','winback','almost','birthday'));