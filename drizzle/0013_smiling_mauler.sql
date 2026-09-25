CREATE TABLE "staff_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"action" varchar(24) NOT NULL,
	"actor_user_id" text NOT NULL,
	"subject_user_id" text,
	"invite_id" uuid,
	"location_id" uuid,
	"role" varchar(12) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_audit_action_valid" CHECK ("staff_audit_events"."action" in ('invite_created','invite_accepted','access_revoked')),
	CONSTRAINT "staff_audit_role_valid" CHECK ("staff_audit_events"."role" in ('manager','cashier'))
);
--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_audit_tenant_time_idx" ON "staff_audit_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE FUNCTION reject_staff_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Staff audit history is append-only';
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER staff_audit_append_only BEFORE UPDATE OR DELETE ON "staff_audit_events" FOR EACH ROW EXECUTE FUNCTION reject_staff_audit_mutation();
