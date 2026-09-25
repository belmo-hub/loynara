CREATE TABLE "apple_devices" (
	"device_library_identifier" varchar(200) PRIMARY KEY NOT NULL,
	"push_token" varchar(300) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apple_registrations" (
	"device_library_identifier" varchar(200) NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"pass_type_identifier" varchar(200) NOT NULL,
	"serial_number" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apple_registrations_device_library_identifier_pass_type_identifier_serial_number_pk" PRIMARY KEY("device_library_identifier","pass_type_identifier","serial_number")
);
--> statement-breakpoint
CREATE TABLE "staff_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"invited_email" varchar(320) NOT NULL,
	"role" varchar(12) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "staff_invite_role_valid" CHECK ("staff_invites"."role" in ('manager','cashier'))
);
--> statement-breakpoint
CREATE TABLE "wallet_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"provider" varchar(8) NOT NULL,
	"provider_object_id" varchar(240) NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_pass_member_provider_uq" UNIQUE("membership_id","provider"),
	CONSTRAINT "wallet_pass_provider_object_uq" UNIQUE("provider","provider_object_id"),
	CONSTRAINT "wallet_pass_provider_valid" CHECK ("wallet_passes"."provider" in ('apple','google'))
);
--> statement-breakpoint
ALTER TABLE "apple_registrations" ADD CONSTRAINT "apple_registrations_device_library_identifier_apple_devices_device_library_identifier_fk" FOREIGN KEY ("device_library_identifier") REFERENCES "public"."apple_devices"("device_library_identifier") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apple_registrations" ADD CONSTRAINT "apple_registrations_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_passes" ADD CONSTRAINT "wallet_passes_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apple_registration_member_idx" ON "apple_registrations" USING btree ("membership_id");
--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_invited_by_user_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;
