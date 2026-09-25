CREATE TABLE "campaign_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"outbox_job_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"status" varchar(12) NOT NULL,
	"reason" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_attempt_once_uq" UNIQUE("outbox_job_id","attempt"),
	CONSTRAINT "campaign_attempt_positive" CHECK ("campaign_attempts"."attempt" > 0),
	CONSTRAINT "campaign_attempt_status_valid" CHECK ("campaign_attempts"."status" in ('complete','suppressed','retry','failed','blocked'))
);
--> statement-breakpoint
CREATE TABLE "campaign_daily_usage" (
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"queued" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "campaign_daily_usage_tenant_id_day_pk" PRIMARY KEY("tenant_id","day"),
	CONSTRAINT "campaign_daily_queued_valid" CHECK ("campaign_daily_usage"."queued" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"status" varchar(12) DEFAULT 'queued' NOT NULL,
	"suppress_reason" varchar(120),
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_recipients_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "campaign_recipient_member_uq" UNIQUE("campaign_id","membership_id"),
	CONSTRAINT "campaign_recipient_status_valid" CHECK ("campaign_recipients"."status" in ('queued','complete','suppressed','failed'))
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"title" varchar(180) NOT NULL,
	"subject" varchar(120) NOT NULL,
	"body" text NOT NULL,
	"audience_definition" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"schedule_revision" integer DEFAULT 0 NOT NULL,
	"audience_as_of" timestamp with time zone,
	"audience_count" integer DEFAULT 0 NOT NULL,
	"queued_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "campaign_status_valid" CHECK ("campaigns"."status" in ('draft','scheduled','paused','dispatching','complete','blocked','cancelled')),
	CONSTRAINT "campaign_schedule_revision_nonnegative" CHECK ("campaigns"."schedule_revision" >= 0),
	CONSTRAINT "campaign_counts_nonnegative" CHECK ("campaigns"."audience_count" >= 0 and "campaigns"."queued_count" >= 0 and "campaigns"."queued_count" <= "campaigns"."audience_count")
);
--> statement-breakpoint
CREATE TABLE "contact_verification_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_verification_challenges_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "campaign_attempts" ADD CONSTRAINT "campaign_attempts_outbox_job_id_outbox_jobs_id_fk" FOREIGN KEY ("outbox_job_id") REFERENCES "public"."outbox_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_attempts" ADD CONSTRAINT "campaign_attempts_tenant_id_recipient_id_campaign_recipients_tenant_id_id_fk" FOREIGN KEY ("tenant_id","recipient_id") REFERENCES "public"."campaign_recipients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_daily_usage" ADD CONSTRAINT "campaign_daily_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_tenant_id_campaign_id_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_program_id_programs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."programs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_verification_challenges" ADD CONSTRAINT "contact_verification_challenges_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_tenant_created_idx" ON "campaigns" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_challenge_membership_idx" ON "contact_verification_challenges" USING btree ("tenant_id","membership_id","created_at");