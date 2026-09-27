ALTER TABLE "email_provider_events" ADD COLUMN "signature_token_hash" varchar(64);--> statement-breakpoint
UPDATE "email_provider_events" SET "signature_token_hash" = md5("id");--> statement-breakpoint
ALTER TABLE "email_provider_events" ALTER COLUMN "signature_token_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "email_provider_events" ADD CONSTRAINT "email_provider_events_signature_token_hash_unique" UNIQUE("signature_token_hash");
