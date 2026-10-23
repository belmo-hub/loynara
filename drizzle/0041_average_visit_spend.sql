-- ENG-070: the owner's average spend per visit (minor units) for the estimated spend of visits without a purchase
-- amount. Nullable, nothing backfilled (null = visits only). Programmes only.
ALTER TABLE "programs" ADD COLUMN "average_visit_spend_minor" integer;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "program_average_visit_spend_valid" CHECK ("programs"."average_visit_spend_minor" is null or "programs"."average_visit_spend_minor" between 1 and 100000);