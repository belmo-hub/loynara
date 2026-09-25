ALTER TABLE "ledger_entries" ADD COLUMN "source" varchar(24) DEFAULT 'legacy_unclassified' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ledger_entries" ALTER COLUMN "source" SET DEFAULT 'staff_online';
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_source_valid" CHECK ("ledger_entries"."source" in ('staff_online','staff_correction','synthetic_seed','legacy_unclassified'));
