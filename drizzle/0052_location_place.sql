ALTER TABLE "locations" ADD COLUMN "google_place_id" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "place_location_fetched_at" timestamp with time zone;