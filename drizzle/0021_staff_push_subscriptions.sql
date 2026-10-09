CREATE TABLE "staff_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" varchar(100) NOT NULL,
	"auth" varchar(40) NOT NULL,
	"locale" varchar(2) DEFAULT 'de' NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_push_subscriptions_endpoint_unique" UNIQUE("endpoint"),
	CONSTRAINT "staff_push_locale_valid" CHECK ("staff_push_subscriptions"."locale" in ('de','fr')),
	CONSTRAINT "staff_push_endpoint_https" CHECK ("staff_push_subscriptions"."endpoint" like 'https://%')
);
--> statement-breakpoint
ALTER TABLE "staff_push_subscriptions" ADD CONSTRAINT "staff_push_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_push_subscriptions" ADD CONSTRAINT "staff_push_subscriptions_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_push_location_idx" ON "staff_push_subscriptions" USING btree ("tenant_id","location_id");--> statement-breakpoint
-- The auth tables come from drizzle/auth.sql (applied before every migration run), so these two keys are written by
-- hand: deleting the user or the login session (sign-out, expiry clean-up) removes the device subscription with it.
ALTER TABLE "staff_push_subscriptions" ADD CONSTRAINT "staff_push_subscriptions_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_push_subscriptions" ADD CONSTRAINT "staff_push_subscriptions_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;
