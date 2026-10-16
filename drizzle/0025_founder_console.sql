CREATE TABLE "admin_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" varchar(16) NOT NULL,
	"admin_user_id" text,
	"roles" text[] NOT NULL,
	"action" varchar(48) NOT NULL,
	"tenant_id" uuid,
	"target_type" varchar(32),
	"target_id" varchar(120),
	"summary" varchar(500) NOT NULL,
	"reason" varchar(500),
	"ip" varchar(64),
	"user_agent" varchar(300),
	CONSTRAINT "admin_audit_actor" CHECK ("admin_audit_events"."actor" in ('console','operator_cli')),
	CONSTRAINT "admin_audit_console_user" CHECK ("admin_audit_events"."actor" = 'operator_cli' or "admin_audit_events"."admin_user_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "admin_idempotency_keys" (
	"admin_user_id" text NOT NULL,
	"key" uuid NOT NULL,
	"action" varchar(48) NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_idempotency_keys_admin_user_id_key_pk" PRIMARY KEY("admin_user_id","key")
);
--> statement-breakpoint
CREATE TABLE "admin_session_activity" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"step_up_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"user_id" text NOT NULL,
	"role" varchar(16) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" varchar(120) NOT NULL,
	CONSTRAINT "platform_admins_user_id_role_pk" PRIMARY KEY("user_id","role"),
	CONSTRAINT "platform_admin_role" CHECK ("platform_admins"."role" in ('founder', 'support', 'sales'))
);
--> statement-breakpoint
CREATE INDEX "admin_audit_at_idx" ON "admin_audit_events" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_audit_user_at_idx" ON "admin_audit_events" USING btree ("admin_user_id","at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE platform_admins ADD CONSTRAINT platform_admin_user_fk FOREIGN KEY(user_id) REFERENCES "user"(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE admin_session_activity ADD CONSTRAINT admin_session_fk FOREIGN KEY(session_id) REFERENCES "session"(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" boolean DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "twoFactor" (
 id text PRIMARY KEY, secret text NOT NULL, "backupCodes" text NOT NULL,
 "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 verified boolean DEFAULT true, "failedVerificationCount" integer DEFAULT 0, "lockedUntil" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS two_factor_user_idx ON "twoFactor"("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS two_factor_secret_idx ON "twoFactor"(secret);
--> statement-breakpoint
CREATE FUNCTION enforce_admin_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' AND current_setting('loynara.audit_retention', true) = 'on' AND OLD.at < now() - interval '3 years' THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Admin audit events are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER admin_audit_append_only BEFORE UPDATE OR DELETE ON admin_audit_events FOR EACH ROW EXECUTE FUNCTION enforce_admin_audit_append_only();
