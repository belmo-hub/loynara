CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"trigger_kind" varchar(20) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"channel" varchar(8) DEFAULT 'email' NOT NULL,
	"subject" varchar(120) NOT NULL,
	"body" text NOT NULL,
	"inactivity_days" integer,
	"cooldown_days" integer DEFAULT 7 NOT NULL,
	"daily_cap" integer DEFAULT 20 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"next_scan_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_rules_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "automation_rules_program_trigger_uq" UNIQUE("program_id","trigger_kind"),
	CONSTRAINT "automation_rule_trigger_valid" CHECK ("automation_rules"."trigger_kind" in ('first_checkout','inactive')),
	CONSTRAINT "automation_rule_channel_valid" CHECK ("automation_rules"."channel" = 'email'),
	CONSTRAINT "automation_rule_cooldown_valid" CHECK ("automation_rules"."cooldown_days" between 7 and 365),
	CONSTRAINT "automation_rule_daily_cap_valid" CHECK ("automation_rules"."daily_cap" between 1 and 20),
	CONSTRAINT "automation_rule_inactivity_valid" CHECK (("automation_rules"."trigger_kind" = 'first_checkout' and "automation_rules"."inactivity_days" is null) or ("automation_rules"."trigger_kind" = 'inactive' and "automation_rules"."inactivity_days" between 7 and 365))
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"rule_revision" integer NOT NULL,
	"trigger_key" varchar(40) NOT NULL,
	"source_entry_id" uuid,
	"status" varchar(12) DEFAULT 'queued' NOT NULL,
	"reason" varchar(120),
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_runs_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "automation_run_once_uq" UNIQUE("rule_id","membership_id","trigger_key"),
	CONSTRAINT "automation_run_status_valid" CHECK ("automation_runs"."status" in ('queued','complete','suppressed','failed')),
	CONSTRAINT "automation_run_attempts_valid" CHECK ("automation_runs"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_tenant_id_program_id_programs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."programs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_tenant_id_rule_id_automation_rules_tenant_id_id_fk" FOREIGN KEY ("tenant_id","rule_id") REFERENCES "public"."automation_rules"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_tenant_id_source_entry_id_ledger_entries_tenant_id_id_fk" FOREIGN KEY ("tenant_id","source_entry_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_run_member_time_idx" ON "automation_runs" USING btree ("tenant_id","membership_id","created_at");