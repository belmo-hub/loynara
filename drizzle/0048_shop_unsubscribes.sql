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
-- An old global unsubscribe moves to every shop that ever sent mail to that address. One no delivery ties to any shop stays
-- as a global legacy unsubscribe (blocking every shop's marketing, never recovery mail) until the 24-month prune: an
-- opt-out is never dropped.
INSERT INTO "email_unsubscribes" ("tenant_id", "recipient_hash", "created_at")
SELECT DISTINCT ON (o."tenant_id", s."recipient_hash") o."tenant_id", s."recipient_hash", s."created_at"
FROM "email_suppressions" s
JOIN "email_deliveries" d ON d."recipient_hash" = s."recipient_hash"
JOIN "outbox_jobs" o ON o."id" = d."job_id"
WHERE s."reason" = 'unsubscribed'
ON CONFLICT DO NOTHING;--> statement-breakpoint
DELETE FROM "email_suppressions" s WHERE s."reason" = 'unsubscribed'
  AND EXISTS (SELECT 1 FROM "email_unsubscribes" u WHERE u."recipient_hash" = s."recipient_hash");
