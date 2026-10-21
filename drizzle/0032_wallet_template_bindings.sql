CREATE TABLE "wallet_template_binding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"action" varchar(8) NOT NULL,
	"old_template_id" uuid,
	"new_template_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_template_binding_action_valid" CHECK (("wallet_template_binding_events"."action" in ('set','import') and "wallet_template_binding_events"."old_template_id" is null) or ("wallet_template_binding_events"."action" = 'change' and "wallet_template_binding_events"."old_template_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "wallet_template_bindings" (
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by_user_id" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_template_bindings_tenant_id_location_id_pk" PRIMARY KEY("tenant_id","location_id"),
	CONSTRAINT "wallet_template_bindings_template_uq" UNIQUE("template_id")
);
--> statement-breakpoint
ALTER TABLE "wallet_template_binding_events" ADD CONSTRAINT "wallet_template_binding_events_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_template_bindings" ADD CONSTRAINT "wallet_template_bindings_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_template_binding_events_scope_idx" ON "wallet_template_binding_events" USING btree ("tenant_id","location_id","created_at");--> statement-breakpoint
CREATE FUNCTION reject_wallet_template_binding_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Wallet template binding events are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER wallet_template_binding_events_append_only BEFORE UPDATE OR DELETE ON "wallet_template_binding_events" FOR EACH ROW EXECUTE FUNCTION reject_wallet_template_binding_event_mutation();
