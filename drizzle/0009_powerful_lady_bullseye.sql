CREATE TABLE "referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_codes_membership_id_unique" UNIQUE("membership_id"),
	CONSTRAINT "referral_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "referral_settings" (
	"program_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"referrer_bonus" integer DEFAULT 0 NOT NULL,
	"referred_bonus" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_settings_bonus_valid" CHECK ("referral_settings"."referrer_bonus" between 0 and 1000 and "referral_settings"."referred_bonus" between 0 and 1000 and (not "referral_settings"."enabled" or "referral_settings"."referrer_bonus" + "referral_settings"."referred_bonus" > 0))
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"referrer_membership_id" uuid NOT NULL,
	"referred_membership_id" uuid NOT NULL,
	"code_id" uuid NOT NULL,
	"referrer_bonus" integer NOT NULL,
	"referred_bonus" integer NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"qualifying_entry_id" uuid,
	"referrer_bonus_entry_id" uuid,
	"referred_bonus_entry_id" uuid,
	"review_reason" varchar(64),
	"review_note" varchar(240),
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"qualified_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_referred_membership_id_unique" UNIQUE("referred_membership_id"),
	CONSTRAINT "referral_members_differ" CHECK ("referrals"."referrer_membership_id" <> "referrals"."referred_membership_id"),
	CONSTRAINT "referral_bonus_snapshot_valid" CHECK ("referrals"."referrer_bonus" between 0 and 1000 and "referrals"."referred_bonus" between 0 and 1000 and "referrals"."referrer_bonus" + "referrals"."referred_bonus" > 0),
	CONSTRAINT "referral_status_valid" CHECK ("referrals"."status" in ('pending','qualified','review','rejected','reversed'))
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_source_valid";--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_tenant_id_program_id_programs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."programs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_settings" ADD CONSTRAINT "referral_settings_tenant_id_program_id_programs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."programs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_code_id_referral_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."referral_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_tenant_id_program_id_programs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."programs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_tenant_id_referrer_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","referrer_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_tenant_id_referred_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","referred_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_tenant_id_qualifying_entry_id_ledger_entries_tenant_id_id_fk" FOREIGN KEY ("tenant_id","qualifying_entry_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_tenant_id_referrer_bonus_entry_id_ledger_entries_tenant_id_id_fk" FOREIGN KEY ("tenant_id","referrer_bonus_entry_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_tenant_id_referred_bonus_entry_id_ledger_entries_tenant_id_id_fk" FOREIGN KEY ("tenant_id","referred_bonus_entry_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "referrals_program_status_idx" ON "referrals" USING btree ("program_id","status","created_at");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_source_valid" CHECK ("ledger_entries"."source" in ('staff_online','staff_correction','synthetic_seed','legacy_unclassified','referral_bonus'));