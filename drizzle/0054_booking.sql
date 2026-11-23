-- Loynara Termin (docs/booking-schema-api.md §1): new tables only, no change to an existing table. btree_gist lets the EXCLUDE constraints mix uuid equality with range overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TABLE "booking_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"during" "tstzrange" NOT NULL,
	"duration_min" integer NOT NULL,
	"price_minor" integer NOT NULL,
	"status" varchar(24) DEFAULT 'requested' NOT NULL,
	"customer_name" varchar(60) NOT NULL,
	"customer_phone" varchar(30),
	"idempotency_key" varchar(100) NOT NULL,
	"reschedule_count" integer DEFAULT 0 NOT NULL,
	"rescheduled_at" timestamp with time zone[] DEFAULT '{}' NOT NULL,
	"late_cancel" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" varchar(80),
	"done_ledger_entry_id" uuid,
	"rebook_sent_at" timestamp with time zone,
	"rebook_source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_appointments_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "booking_appointments_idempotency_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "booking_appointment_status_valid" CHECK ("booking_appointments"."status" in ('requested','confirmed','done','no_show','cancelled_by_customer','cancelled_by_shop')),
	CONSTRAINT "booking_appointment_bounded" CHECK (lower_inc("booking_appointments"."during") and not upper_inc("booking_appointments"."during") and not lower_inf("booking_appointments"."during") and not upper_inf("booking_appointments"."during")),
	CONSTRAINT "booking_appointment_done_entry" CHECK (("booking_appointments"."status" = 'done') or "booking_appointments"."done_ledger_entry_id" is null),
	CONSTRAINT "booking_appointment_cancel_valid" CHECK (("booking_appointments"."status" like 'cancelled_%') = ("booking_appointments"."cancelled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "booking_blocked_customers" (
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"blocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_by_user_id" text,
	"reason" varchar(80) DEFAULT '' NOT NULL,
	CONSTRAINT "booking_blocked_customers_tenant_id_membership_id_pk" PRIMARY KEY("tenant_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "booking_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"staff_id" uuid,
	"during" "tstzrange" NOT NULL,
	"reason" varchar(80) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_block_bounded" CHECK (lower_inc("booking_blocks"."during") and not upper_inc("booking_blocks"."during") and not lower_inf("booking_blocks"."during") and not upper_inf("booking_blocks"."during"))
);
--> statement-breakpoint
CREATE TABLE "booking_push_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"appointment_id" uuid,
	"kind" varchar(16) NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_push_log_appointment_kind_uq" UNIQUE("appointment_id","kind"),
	CONSTRAINT "booking_push_kind_valid" CHECK ("booking_push_log"."kind" in ('reminder_24h','reminder_2h','rebook','shop_cancel','moved','confirmed'))
);
--> statement-breakpoint
CREATE TABLE "booking_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" varchar(100) NOT NULL,
	"auth" varchar(40) NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_push_subscriptions_endpoint_unique" UNIQUE("endpoint"),
	CONSTRAINT "booking_push_endpoint_https" CHECK ("booking_push_subscriptions"."endpoint" like 'https://%')
);
--> statement-breakpoint
CREATE TABLE "booking_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"duration_min" integer NOT NULL,
	"buffer_min" integer DEFAULT 0 NOT NULL,
	"price_minor" integer NOT NULL,
	"price_from" boolean DEFAULT false NOT NULL,
	"rebook_after_days" integer DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_services_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "booking_service_valid" CHECK ("booking_services"."duration_min" between 5 and 480 and "booking_services"."duration_min" % 5 = 0 and "booking_services"."buffer_min" between 0 and 60 and "booking_services"."price_minor" between 0 and 100000 and "booking_services"."rebook_after_days" between 0 and 365)
);
--> statement-breakpoint
CREATE TABLE "booking_settings" (
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"shop_type" varchar(12) DEFAULT 'barber' NOT NULL,
	"goal_text" varchar(140) DEFAULT '' NOT NULL,
	"lead_time_min" integer DEFAULT 120 NOT NULL,
	"max_days_ahead" integer DEFAULT 42 NOT NULL,
	"cancel_deadline_hours" integer DEFAULT 24 NOT NULL,
	"max_reschedules_per_month" integer DEFAULT 2 NOT NULL,
	"auto_confirm" boolean DEFAULT true NOT NULL,
	"no_show_block_after" integer DEFAULT 3 NOT NULL,
	"max_open_per_card" integer DEFAULT 2 NOT NULL,
	"terms_text" varchar(600) DEFAULT '' NOT NULL,
	"opening_hours" jsonb,
	"setup_done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_settings_tenant_id_location_id_pk" PRIMARY KEY("tenant_id","location_id"),
	CONSTRAINT "booking_settings_valid" CHECK ("booking_settings"."shop_type" in ('nagelstudio','barber','kosmetik') and "booking_settings"."lead_time_min" between 0 and 1440 and "booking_settings"."max_days_ahead" between 1 and 180 and "booking_settings"."cancel_deadline_hours" between 0 and 168 and "booking_settings"."max_reschedules_per_month" between 0 and 10 and "booking_settings"."no_show_block_after" between 0 and 10 and "booking_settings"."max_open_per_card" between 1 and 2)
);
--> statement-breakpoint
CREATE TABLE "booking_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" varchar(60) NOT NULL,
	"user_id" text,
	"working_hours" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_staff_tenant_id_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "booking_staff_services" (
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	CONSTRAINT "booking_staff_services_staff_id_service_id_pk" PRIMARY KEY("staff_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD CONSTRAINT "booking_appointments_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD CONSTRAINT "booking_appointments_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD CONSTRAINT "booking_appointments_tenant_id_service_id_booking_services_tenant_id_id_fk" FOREIGN KEY ("tenant_id","service_id") REFERENCES "public"."booking_services"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD CONSTRAINT "booking_appointments_tenant_id_staff_id_booking_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."booking_staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD CONSTRAINT "booking_appointments_tenant_id_done_ledger_entry_id_ledger_entries_tenant_id_id_fk" FOREIGN KEY ("tenant_id","done_ledger_entry_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_blocked_customers" ADD CONSTRAINT "booking_blocked_customers_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_blocks" ADD CONSTRAINT "booking_blocks_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_blocks" ADD CONSTRAINT "booking_blocks_tenant_id_staff_id_booking_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."booking_staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_push_log" ADD CONSTRAINT "booking_push_log_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_push_subscriptions" ADD CONSTRAINT "booking_push_subscriptions_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_settings" ADD CONSTRAINT "booking_settings_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_staff" ADD CONSTRAINT "booking_staff_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_staff_services" ADD CONSTRAINT "booking_staff_services_tenant_id_staff_id_booking_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."booking_staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_staff_services" ADD CONSTRAINT "booking_staff_services_tenant_id_service_id_booking_services_tenant_id_id_fk" FOREIGN KEY ("tenant_id","service_id") REFERENCES "public"."booking_services"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_appointments_member_idx" ON "booking_appointments" USING btree ("tenant_id","membership_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_appointments_done_entry_uq" ON "booking_appointments" USING btree ("tenant_id","done_ledger_entry_id") WHERE "booking_appointments"."done_ledger_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "booking_push_log_member_idx" ON "booking_push_log" USING btree ("tenant_id","membership_id","sent_at");--> statement-breakpoint
CREATE INDEX "booking_push_member_idx" ON "booking_push_subscriptions" USING btree ("tenant_id","membership_id");--> statement-breakpoint
-- Hand-written: drizzle-kit cannot express EXCLUDE constraints or gist indexes on ranges.
ALTER TABLE "booking_appointments" ADD CONSTRAINT "booking_staff_no_overlap" EXCLUDE USING gist ("staff_id" WITH =, "during" WITH &&) WHERE ("status" in ('requested','confirmed'));--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD CONSTRAINT "booking_member_no_overlap" EXCLUDE USING gist ("membership_id" WITH =, "during" WITH &&) WHERE ("status" in ('requested','confirmed'));--> statement-breakpoint
CREATE INDEX "booking_appointments_day_idx" ON "booking_appointments" USING gist ("tenant_id","location_id","during");--> statement-breakpoint
CREATE INDEX "booking_blocks_location_idx" ON "booking_blocks" USING gist ("tenant_id","location_id","during");
