CREATE TABLE "rate_limits" (
	"key_hash" varchar(64) PRIMARY KEY NOT NULL,
	"hits" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limits_hits_positive" CHECK ("rate_limits"."hits" > 0)
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "rate_limits_reset_idx" ON "rate_limits" USING btree ("reset_at");