-- ENG-170 (Legal): a promotional unsubscribe belongs to the shop whose mail it came from; permanent failures and complaints
-- stay global for every kind of mail and are deleted 24 months after their last event.
CREATE TABLE "email_unsubscribes" (
	"tenant_id" uuid NOT NULL,
	"recipient_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_unsubscribes_tenant_id_recipient_hash_pk" PRIMARY KEY("tenant_id","recipient_hash")
);
--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD COLUMN "last_event_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- The last event known for an existing row is its creation (a repeat event never updated it).
UPDATE "email_suppressions" SET "last_event_at" = "created_at";--> statement-breakpoint
-- An old global unsubscribe moves to every shop whose mail to that address recorded one; one no delivery ties to a shop is dropped.
INSERT INTO "email_unsubscribes" ("tenant_id", "recipient_hash", "created_at")
SELECT DISTINCT ON (o."tenant_id", s."recipient_hash") o."tenant_id", s."recipient_hash", s."created_at"
FROM "email_suppressions" s
JOIN "email_deliveries" d ON d."recipient_hash" = s."recipient_hash"
JOIN "email_provider_events" e ON e."job_id" = d."job_id" AND e."event" = 'unsubscribed'
JOIN "outbox_jobs" o ON o."id" = d."job_id"
WHERE s."reason" = 'unsubscribed'
ON CONFLICT DO NOTHING;--> statement-breakpoint
DELETE FROM "email_suppressions" WHERE "reason" = 'unsubscribed';
