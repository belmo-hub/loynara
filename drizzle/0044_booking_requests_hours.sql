ALTER TABLE "booking_push_log" DROP CONSTRAINT "booking_push_kind_valid";--> statement-breakpoint
ALTER TABLE "booking_settings" ADD COLUMN "opening_hours" jsonb;--> statement-breakpoint
ALTER TABLE "booking_push_log" ADD CONSTRAINT "booking_push_kind_valid" CHECK ("booking_push_log"."kind" in ('reminder_24h','reminder_2h','rebook','shop_cancel','moved','confirmed'));