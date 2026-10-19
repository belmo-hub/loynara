-- Shop sender address for marketing mail (A-11). Nullable without default: metadata-only, no table rewrite; old code ignores both columns.
ALTER TABLE "locations" ADD COLUMN "street" varchar(180);--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "postal_code" varchar(5);
