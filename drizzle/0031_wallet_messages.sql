CREATE TABLE "wallet_message_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"text_version" varchar(40) NOT NULL,
	"channel" varchar(8) DEFAULT 'wallet' NOT NULL,
	"given_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "wallet_message_consent_channel_valid" CHECK ("wallet_message_consents"."channel" = 'wallet')
);
--> statement-breakpoint
CREATE TABLE "wallet_message_owner_confirmations" (
	"tenant_id" uuid NOT NULL,
	"version" varchar(40) NOT NULL,
	"confirmed_by_user_id" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_message_owner_confirmations_tenant_id_version_pk" PRIMARY KEY("tenant_id","version")
);
--> statement-breakpoint
CREATE TABLE "wallet_message_recipients" (
	"message_id" uuid NOT NULL,
	"pass_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"status" varchar(8) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"reason" varchar(40),
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "wallet_message_recipients_message_id_pass_id_pk" PRIMARY KEY("message_id","pass_id"),
	CONSTRAINT "wallet_message_recipient_status_valid" CHECK ("wallet_message_recipients"."status" in ('queued','sending','sent','failed','skipped'))
);
--> statement-breakpoint
CREATE TABLE "wallet_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"kind" varchar(8) DEFAULT 'owner' NOT NULL,
	"sent_by_user_id" text,
	"text" varchar(560) NOT NULL,
	"confirm_version" varchar(40),
	"status" varchar(8) DEFAULT 'queued' NOT NULL,
	"audience_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"stopped_at" timestamp with time zone,
	CONSTRAINT "wallet_messages_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "wallet_message_kind_valid" CHECK ("wallet_messages"."kind" in ('owner','winback')),
	CONSTRAINT "wallet_message_status_valid" CHECK ("wallet_messages"."status" in ('queued','sending','complete','stopped'))
);
--> statement-breakpoint
CREATE TABLE "wallet_pass_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pass_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event" varchar(24) NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_pass_event_once_uq" UNIQUE("pass_id","event","event_at"),
	CONSTRAINT "wallet_pass_event_valid" CHECK ("wallet_pass_events"."event" in ('device.registered','device.unregistered'))
);
--> statement-breakpoint
ALTER TABLE "wallet_message_consents" ADD CONSTRAINT "wallet_message_consents_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_message_owner_confirmations" ADD CONSTRAINT "wallet_message_owner_confirmations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_message_recipients" ADD CONSTRAINT "wallet_message_recipients_tenant_id_message_id_wallet_messages_tenant_id_id_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."wallet_messages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_message_recipients" ADD CONSTRAINT "wallet_message_recipients_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_messages" ADD CONSTRAINT "wallet_messages_tenant_id_program_id_programs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."programs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_pass_events" ADD CONSTRAINT "wallet_pass_events_pass_id_wallet_passes_id_fk" FOREIGN KEY ("pass_id") REFERENCES "public"."wallet_passes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_message_consent_open_uq" ON "wallet_message_consents" USING btree ("membership_id") WHERE "wallet_message_consents"."withdrawn_at" is null;--> statement-breakpoint
CREATE INDEX "wallet_message_consent_member_idx" ON "wallet_message_consents" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "wallet_message_recipient_member_idx" ON "wallet_message_recipients" USING btree ("tenant_id","membership_id","created_at");--> statement-breakpoint
CREATE INDEX "wallet_message_recipient_due_idx" ON "wallet_message_recipients" USING btree ("message_id","status","retry_at");--> statement-breakpoint
CREATE INDEX "wallet_messages_program_idx" ON "wallet_messages" USING btree ("tenant_id","program_id","created_at");--> statement-breakpoint
CREATE INDEX "wallet_pass_event_pass_idx" ON "wallet_pass_events" USING btree ("pass_id","event_at");--> statement-breakpoint
CREATE FUNCTION reject_wallet_consent_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Wallet message consents are append-only'; END IF;
  IF OLD.withdrawn_at IS NOT NULL OR NEW.withdrawn_at IS NULL
    OR (NEW.id, NEW.tenant_id, NEW.membership_id, NEW.text_version, NEW.channel, NEW.given_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.membership_id, OLD.text_version, OLD.channel, OLD.given_at) THEN
    RAISE EXCEPTION 'Wallet message consents are append-only: only a first withdrawal may be recorded';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER wallet_message_consents_append_only BEFORE UPDATE OR DELETE ON "wallet_message_consents" FOR EACH ROW EXECUTE FUNCTION reject_wallet_consent_mutation();
