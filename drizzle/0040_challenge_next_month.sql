-- ENG-065: a change to a running monthly challenge starts with the next calendar month. Three nullable programme columns
-- hold the pending terms; nothing is backfilled (no pending change anywhere). Programmes only: the ledger and message
-- checks of 0037/0038 (X-1 unions) are untouched.
ALTER TABLE "programs" ADD COLUMN "challenge_next_from" date;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "challenge_next_visits" integer;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "challenge_next_bonus" integer;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "program_challenge_next_valid" CHECK (("programs"."challenge_next_from" is null and "programs"."challenge_next_visits" is null and "programs"."challenge_next_bonus" is null) or ("programs"."challenge_next_from" is not null and extract(day from "programs"."challenge_next_from") = 1 and (("programs"."challenge_next_visits" is null and "programs"."challenge_next_bonus" is null) or ("programs"."challenge_next_visits" between 2 and 10 and "programs"."challenge_next_bonus" between 1 and (case when "programs"."type" = 'stamp' then 3 else 25000 end)))));