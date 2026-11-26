-- ENG-339 (founder Q-113, Legal 22 Nov): an owner accepts a later AVV Fassung in the app. Such a row has path 'booking' and
-- always its business; rows stay append-only (the triggers from 0051 are unchanged).
ALTER TABLE "owner_acceptances" DROP CONSTRAINT "owner_acceptances_path_valid";--> statement-breakpoint
ALTER TABLE "owner_acceptances" ADD CONSTRAINT "owner_acceptances_path_valid" CHECK ("owner_acceptances"."path" = 'register' or ("owner_acceptances"."path" = 'booking' and "owner_acceptances"."tenant_id" is not null));