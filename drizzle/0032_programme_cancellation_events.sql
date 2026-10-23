CREATE TABLE "programme_cancellation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"action" varchar(8) NOT NULL,
	"actor_user_id" text NOT NULL,
	"old_end_date" date,
	"new_end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programme_cancellation_action_valid" CHECK ("programme_cancellation_events"."action" in ('request','withdraw','schedule','confirm','end'))
);
--> statement-breakpoint
ALTER TABLE "programme_cancellation_events" ADD CONSTRAINT "programme_cancellation_events_program_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."programs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "programme_cancellation_events_program_idx" ON "programme_cancellation_events" USING btree ("program_id","created_at");--> statement-breakpoint
CREATE TRIGGER programme_cancellation_events_append_only BEFORE UPDATE OR DELETE ON "programme_cancellation_events" FOR EACH ROW EXECUTE FUNCTION reject_programme_audit_mutation();