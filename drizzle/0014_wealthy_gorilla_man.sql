CREATE TABLE "secure_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_ref" varchar(32) NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"uid" varchar(14) NOT NULL,
	"key_ref" varchar(160) NOT NULL,
	"config_version" integer NOT NULL,
	"last_counter" integer DEFAULT 0 NOT NULL,
	"status" varchar(12) DEFAULT 'provisioned' NOT NULL,
	"replaces_tag_id" uuid,
	"provisioned_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secure_tags_public_ref_unique" UNIQUE("public_ref"),
	CONSTRAINT "secure_tags_uid_unique" UNIQUE("uid"),
	CONSTRAINT "secure_tag_status_valid" CHECK ("secure_tags"."status" in ('provisioned','active','revoked','replaced')),
	CONSTRAINT "secure_tag_counter_valid" CHECK ("secure_tags"."last_counter" between 0 and 16777215),
	CONSTRAINT "secure_tag_version_valid" CHECK ("secure_tags"."config_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "tap_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tag_id" uuid NOT NULL,
	"counter" integer NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"membership_id" uuid,
	"status" varchar(20) NOT NULL,
	"ledger_entry_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tap_request_counter_uq" UNIQUE("tag_id","counter"),
	CONSTRAINT "tap_request_counter_valid" CHECK ("tap_requests"."counter" between 1 and 16777215),
	CONSTRAINT "tap_request_status_valid" CHECK ("tap_requests"."status" in ('awarded','cooldown','pending_staff','confirmed','expired'))
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_source_valid";--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "tap_mode" varchar(20) DEFAULT 'disabled' NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "tap_cooldown_seconds" integer;--> statement-breakpoint
ALTER TABLE "secure_tags" ADD CONSTRAINT "secure_tags_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secure_tags" ADD CONSTRAINT "secure_tags_tenant_id_program_id_programs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."programs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tap_requests" ADD CONSTRAINT "tap_requests_tag_id_secure_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."secure_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tap_requests" ADD CONSTRAINT "tap_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tap_requests" ADD CONSTRAINT "tap_requests_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tap_requests" ADD CONSTRAINT "tap_requests_tenant_id_program_id_programs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."programs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tap_requests" ADD CONSTRAINT "tap_requests_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_source_valid" CHECK ("ledger_entries"."source" in ('staff_online','staff_offline','staff_correction','synthetic_seed','legacy_unclassified','referral_bonus','nfc_tap'));--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "program_tap_mode_valid" CHECK ("programs"."tap_mode" in ('disabled','automatic_fixed','staff_confirmed'));--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "program_tap_cooldown_valid" CHECK ("programs"."tap_cooldown_seconds" is null or "programs"."tap_cooldown_seconds" between 1 and 86400);