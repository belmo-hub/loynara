ALTER TABLE "programs" DROP CONSTRAINT "program_status_valid";--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "cancellation_end_date" date;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "cancellation_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "program_status_valid" CHECK ("programs"."status" in ('active','archived','ended'));