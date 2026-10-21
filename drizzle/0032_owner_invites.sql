ALTER TABLE "staff_audit_events" DROP CONSTRAINT "staff_audit_role_valid";--> statement-breakpoint
ALTER TABLE "staff_invites" DROP CONSTRAINT "staff_invite_role_valid";--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_role_valid" CHECK ("staff_audit_events"."role" in ('owner','manager','cashier'));--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invite_role_valid" CHECK ("staff_invites"."role" in ('owner','manager','cashier'));--> statement-breakpoint
CREATE TABLE "plate_activation_codes" (
	"tag_id" uuid PRIMARY KEY NOT NULL,
	"code_hash" varchar(160) NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"issued_by_user_id" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plate_activation_attempts_valid" CHECK ("plate_activation_codes"."failed_attempts" between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "plate_activation_codes" ADD CONSTRAINT "plate_activation_codes_tag_id_secure_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."secure_tags"("id") ON DELETE no action ON UPDATE no action;