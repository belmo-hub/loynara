CREATE TABLE "card_recovery_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_recovery_challenges_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "card_security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"action" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"provider" varchar(16) NOT NULL,
	"recipient_hash" varchar(64) NOT NULL,
	"provider_message_id" varchar(255),
	"status" varchar(24) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_provider_events" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"job_id" uuid,
	"event" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"recipient_hash" varchar(64) PRIMARY KEY NOT NULL,
	"reason" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_security_events" ADD CONSTRAINT "card_security_events_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_job_id_outbox_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."outbox_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_provider_events" ADD CONSTRAINT "email_provider_events_job_id_outbox_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."outbox_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_recovery_email_idx" ON "card_recovery_challenges" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "card_security_membership_idx" ON "card_security_events" USING btree ("tenant_id","membership_id","created_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_message_idx" ON "email_deliveries" USING btree ("provider_message_id");