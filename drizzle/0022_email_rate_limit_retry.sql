-- Additive only: existing delivery outcomes retain their reservation and cannot replay.
ALTER TABLE "email_deliveries" ADD COLUMN "retry_at" timestamp with time zone;
