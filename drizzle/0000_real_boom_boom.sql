CREATE TABLE "consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"channel" varchar(12) NOT NULL,
	"purpose" varchar(24) NOT NULL,
	"granted" boolean NOT NULL,
	"notice_version" varchar(32) NOT NULL,
	"source" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"business" varchar(180) NOT NULL,
	"city" varchar(120) NOT NULL,
	"email" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"kind" varchar(12) NOT NULL,
	"actor_user_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"idempotency_key" varchar(100) NOT NULL,
	"device_at" timestamp with time zone,
	"reason" varchar(240),
	"reversal_of_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "ledger_idempotency_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "ledger_delta_nonzero" CHECK ("ledger_entries"."delta" <> 0),
	CONSTRAINT "ledger_kind_valid" CHECK ("ledger_entries"."kind" in ('award','redeem','reversal'))
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(180) NOT NULL,
	"city" varchar(120) NOT NULL,
	"country" varchar(2) NOT NULL,
	"timezone" varchar(80) NOT NULL,
	"contact_email" varchar(320),
	"brand_color" varchar(7) DEFAULT '#264C45' NOT NULL,
	"logo_data" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_tenant_id_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "membership_contacts" (
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"email" varchar(320),
	"email_verified" boolean DEFAULT false NOT NULL,
	"recovery_token_hash" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_contacts_tenant_id_membership_id_pk" PRIMARY KEY("tenant_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"scan_code" varchar(64) NOT NULL,
	"card_token" varchar(100) NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_scan_code_unique" UNIQUE("scan_code"),
	CONSTRAINT "memberships_card_token_unique" UNIQUE("card_token"),
	CONSTRAINT "memberships_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "membership_balance_nonnegative" CHECK ("memberships"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "outbox_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" varchar(180) NOT NULL,
	"type" varchar(8) NOT NULL,
	"status" varchar(10) DEFAULT 'active' NOT NULL,
	"points_per_euro" integer DEFAULT 1 NOT NULL,
	"rules_text" text NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programs_slug_unique" UNIQUE("slug"),
	CONSTRAINT "programs_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "program_type_valid" CHECK ("programs"."type" in ('stamp','points')),
	CONSTRAINT "program_status_valid" CHECK ("programs"."status" in ('active','archived')),
	CONSTRAINT "program_points_positive" CHECK ("programs"."points_per_euro" > 0)
);
--> statement-breakpoint
CREATE TABLE "redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"reward_version_id" uuid NOT NULL,
	"reward_title" varchar(180) NOT NULL,
	"cost" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reward_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" varchar(180) NOT NULL,
	"cost" integer NOT NULL,
	"terms_text" text DEFAULT '' NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_versions_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "reward_versions_number_uq" UNIQUE("reward_id","version"),
	CONSTRAINT "reward_cost_positive" CHECK ("reward_versions"."cost" > 0)
);
--> statement-breakpoint
CREATE TABLE "rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rewards_tenant_id_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "staff_roles" (
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" varchar(12) NOT NULL,
	"location_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_roles_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id"),
	CONSTRAINT "staff_role_valid" CHECK ("staff_roles"."role" in ('owner','manager','cashier'))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(24) DEFAULT 'manual_pending' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"price_minor" integer NOT NULL,
	"active_location_count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(180) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"locale" varchar(5) DEFAULT 'de' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_reversal_of_id_ledger_entries_tenant_id_id_fk" FOREIGN KEY ("tenant_id","reversal_of_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_contacts" ADD CONSTRAINT "membership_contacts_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_program_id_programs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."programs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_tenant_id_ledger_entry_id_ledger_entries_tenant_id_id_fk" FOREIGN KEY ("tenant_id","ledger_entry_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_tenant_id_reward_version_id_reward_versions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","reward_version_id") REFERENCES "public"."reward_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_versions" ADD CONSTRAINT "reward_versions_tenant_id_reward_id_rewards_tenant_id_id_fk" FOREIGN KEY ("tenant_id","reward_id") REFERENCES "public"."rewards"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_tenant_id_program_id_programs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."programs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_membership_idx" ON "consent_events" USING btree ("tenant_id","membership_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_member_time_idx" ON "ledger_entries" USING btree ("membership_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_due_idx" ON "outbox_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "programs_one_active_per_location_uq" ON "programs" USING btree ("location_id") WHERE "programs"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "redemptions_ledger_uq" ON "redemptions" USING btree ("ledger_entry_id");
--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_user_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_actor_user_fk" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_location_scope_valid" CHECK (("role" = 'owner' AND "location_id" IS NULL) OR ("role" IN ('manager','cashier') AND "location_id" IS NOT NULL));
--> statement-breakpoint
CREATE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ledger history is append-only'; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
