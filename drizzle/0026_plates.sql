CREATE TABLE "plate_link_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tag_id" uuid NOT NULL,
	"plate_label" varchar(16) NOT NULL,
	"action" varchar(8) NOT NULL,
	"actor_user_id" text NOT NULL,
	"old_tenant_id" uuid,
	"old_location_id" uuid,
	"old_program_id" uuid,
	"new_tenant_id" uuid,
	"new_location_id" uuid,
	"new_program_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plate_link_action_valid" CHECK (("plate_link_events"."action" = 'link' and "plate_link_events"."old_program_id" is null and "plate_link_events"."new_program_id" is not null) or ("plate_link_events"."action" = 'relink' and "plate_link_events"."old_program_id" is not null and "plate_link_events"."new_program_id" is not null) or ("plate_link_events"."action" = 'unlink' and "plate_link_events"."old_program_id" is not null and "plate_link_events"."new_program_id" is null) or ("plate_link_events"."action" = 'revoke' and "plate_link_events"."old_program_id" is null and "plate_link_events"."new_program_id" is null))
);
--> statement-breakpoint
ALTER TABLE "secure_tags" DROP CONSTRAINT "secure_tag_status_valid";--> statement-breakpoint
DROP INDEX "secure_tag_uid_live_uq";--> statement-breakpoint
ALTER TABLE "secure_tags" ALTER COLUMN "tenant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "secure_tags" ALTER COLUMN "location_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "secure_tags" ALTER COLUMN "program_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "secure_tags" ADD COLUMN "plate_label" varchar(16);--> statement-breakpoint
ALTER TABLE "plate_link_events" ADD CONSTRAINT "plate_link_events_tag_id_secure_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."secure_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plate_link_events_tag_time_idx" ON "plate_link_events" USING btree ("tag_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "secure_tag_uid_live_uq" ON "secure_tags" USING btree ("uid") WHERE "secure_tags"."status" in ('provisioned','active','unlinked');--> statement-breakpoint
ALTER TABLE "secure_tags" ADD CONSTRAINT "secure_tags_plate_label_unique" UNIQUE("plate_label");--> statement-breakpoint
ALTER TABLE "secure_tags" ADD CONSTRAINT "secure_tag_binding_valid" CHECK (("secure_tags"."tenant_id" is not null and "secure_tags"."location_id" is not null and "secure_tags"."program_id" is not null and "secure_tags"."status" <> 'unlinked') or ("secure_tags"."tenant_id" is null and "secure_tags"."location_id" is null and "secure_tags"."program_id" is null and "secure_tags"."plate_label" is not null and "secure_tags"."status" in ('unlinked','revoked')));--> statement-breakpoint
ALTER TABLE "secure_tags" ADD CONSTRAINT "secure_tag_plate_label_valid" CHECK ("secure_tags"."plate_label" ~ '^[A-Z]{1,4}-[0-9]{1,6}$');--> statement-breakpoint
ALTER TABLE "secure_tags" ADD CONSTRAINT "secure_tag_status_valid" CHECK ("secure_tags"."status" in ('provisioned','active','revoked','replaced','unlinked'));--> statement-breakpoint
CREATE FUNCTION reject_plate_link_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Plate link events are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER plate_link_events_append_only BEFORE UPDATE OR DELETE ON "plate_link_events" FOR EACH ROW EXECUTE FUNCTION reject_plate_link_event_mutation();
