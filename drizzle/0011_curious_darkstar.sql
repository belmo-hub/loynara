CREATE TABLE "offline_award_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lease_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"award_payload" jsonb NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"status" varchar(12) NOT NULL,
	"reason" varchar(48),
	"ledger_entry_id" uuid,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offline_event_status_valid" CHECK ("offline_award_events"."status" in ('accepted','rejected'))
);
--> statement-breakpoint
CREATE TABLE "offline_award_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"device_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_source_valid";--> statement-breakpoint
ALTER TABLE "offline_award_events" ADD CONSTRAINT "offline_award_events_lease_id_offline_award_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."offline_award_leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_award_events" ADD CONSTRAINT "offline_award_events_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_award_events" ADD CONSTRAINT "offline_award_events_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_award_events" ADD CONSTRAINT "offline_award_events_tenant_id_ledger_entry_id_ledger_entries_tenant_id_id_fk" FOREIGN KEY ("tenant_id","ledger_entry_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_award_leases" ADD CONSTRAINT "offline_award_leases_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_award_leases" ADD CONSTRAINT "offline_award_leases_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offline_event_lease_idx" ON "offline_award_events" USING btree ("lease_id","processed_at");--> statement-breakpoint
CREATE INDEX "offline_lease_actor_expiry_idx" ON "offline_award_leases" USING btree ("actor_user_id","expires_at");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_source_valid" CHECK ("ledger_entries"."source" in ('staff_online','staff_offline','staff_correction','synthetic_seed','legacy_unclassified','referral_bonus'));