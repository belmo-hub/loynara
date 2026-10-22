ALTER TABLE "billing_handoffs" DROP CONSTRAINT "billing_handoff_values_valid";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscription_status_valid";--> statement-breakpoint
ALTER TABLE "billing_handoffs" ADD COLUMN "provider_ref" varchar(120);--> statement-breakpoint
ALTER TABLE "billing_location_plans" ADD COLUMN "guarantee_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_location_plans" ADD COLUMN "guarantee_customers" integer;--> statement-breakpoint
ALTER TABLE "billing_location_plans" ADD COLUMN "guarantee_applied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "plan_code" varchar(16);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider_customer_id" varchar(64);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider_subscription_id" varchar(64);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_handoffs" ADD CONSTRAINT "billing_handoffs_provider_ref_unique" UNIQUE("provider_ref");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_provider_customer_id_unique" UNIQUE("provider_customer_id");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_provider_subscription_id_unique" UNIQUE("provider_subscription_id");--> statement-breakpoint
ALTER TABLE "billing_handoffs" ADD CONSTRAINT "billing_handoff_values_valid" CHECK ("billing_handoffs"."provider" in ('local_fixture','stripe') and "billing_handoffs"."status" in ('pending','complete','expired') and "billing_handoffs"."amount_minor" > 0);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscription_plan_valid" CHECK ("subscriptions"."plan_code" is null or "subscriptions"."plan_code" in ('founding','list'));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscription_status_valid" CHECK ("subscriptions"."status" in ('manual_pending','pending_checkout','active_fixture','grace_fixture','suspended_fixture','cancelled','active','past_due','suspended'));