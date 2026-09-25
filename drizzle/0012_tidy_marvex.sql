CREATE TABLE "billing_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" varchar(24) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"amount_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "billing_handoff_values_valid" CHECK ("billing_handoffs"."provider" = 'local_fixture' and "billing_handoffs"."status" in ('pending','complete') and "billing_handoffs"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "billing_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"handoff_id" uuid NOT NULL,
	"provider_invoice_id" varchar(120) NOT NULL,
	"status" varchar(24) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"amount_minor" integer NOT NULL,
	"tax_minor" integer,
	"period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_invoices_provider_invoice_id_unique" UNIQUE("provider_invoice_id"),
	CONSTRAINT "billing_invoice_values_valid" CHECK ("billing_invoices"."status" = 'fixture_paid' and "billing_invoices"."amount_minor" > 0 and "billing_invoices"."tax_minor" is null)
);
--> statement-breakpoint
CREATE TABLE "billing_location_plans" (
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"plan_code" varchar(32) DEFAULT 'local_standard' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"price_minor" integer NOT NULL,
	"member_limit" integer DEFAULT 10000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_location_plans_tenant_id_location_id_pk" PRIMARY KEY("tenant_id","location_id"),
	CONSTRAINT "billing_plan_values_valid" CHECK ("billing_location_plans"."price_minor" > 0 and "billing_location_plans"."member_limit" > 0 and "billing_location_plans"."plan_code" = 'local_standard')
);
--> statement-breakpoint
CREATE TABLE "billing_webhook_events" (
	"event_id" varchar(120) PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider" varchar(24);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "current_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "grace_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_handoffs" ADD CONSTRAINT "billing_handoffs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_handoff_id_billing_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "public"."billing_handoffs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_location_plans" ADD CONSTRAINT "billing_location_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_location_plans" ADD CONSTRAINT "billing_location_plans_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_webhook_events" ADD CONSTRAINT "billing_webhook_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_handoff_tenant_idx" ON "billing_handoffs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_invoice_tenant_idx" ON "billing_invoices" USING btree ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscription_status_valid" CHECK ("subscriptions"."status" in ('manual_pending','pending_checkout','active_fixture','grace_fixture','suspended_fixture','cancelled'));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscription_price_positive" CHECK ("subscriptions"."price_minor" > 0 and "subscriptions"."active_location_count" > 0);--> statement-breakpoint
INSERT INTO "billing_location_plans" ("tenant_id", "location_id", "currency", "price_minor")
SELECT l."tenant_id", l."id", s."currency", s."price_minor"
FROM "locations" l JOIN "subscriptions" s ON s."tenant_id" = l."tenant_id";--> statement-breakpoint
UPDATE "subscriptions" s SET "active_location_count" = counts."total"
FROM (SELECT "tenant_id", count(*)::int AS "total" FROM "locations" GROUP BY "tenant_id") counts
WHERE s."tenant_id" = counts."tenant_id";
