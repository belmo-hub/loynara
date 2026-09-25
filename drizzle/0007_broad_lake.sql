CREATE TABLE "program_rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(180) NOT NULL,
	"type" varchar(8) NOT NULL,
	"rules_text" text NOT NULL,
	"earning_mode" varchar(8) NOT NULL,
	"points_per_currency_unit" integer NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_rule_versions_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "program_rule_versions_number_uq" UNIQUE("program_id","version"),
	CONSTRAINT "program_rule_version_type_valid" CHECK ("program_rule_versions"."type" in ('stamp','points')),
	CONSTRAINT "program_rule_version_earning_mode_valid" CHECK ("program_rule_versions"."earning_mode" in ('manual','purchase')),
	CONSTRAINT "program_rule_version_points_valid" CHECK ("program_rule_versions"."points_per_currency_unit" between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "purchase_awards" (
	"ledger_entry_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_version_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"applied_rate" integer NOT NULL,
	"points_awarded" integer NOT NULL,
	"rounding" varchar(8) DEFAULT 'floor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_amount_positive" CHECK ("purchase_awards"."amount_minor" between 1 and 10000000),
	CONSTRAINT "purchase_rate_positive" CHECK ("purchase_awards"."applied_rate" between 1 and 1000),
	CONSTRAINT "purchase_points_positive" CHECK ("purchase_awards"."points_awarded" > 0),
	CONSTRAINT "purchase_currency_valid" CHECK ("purchase_awards"."currency" in ('EUR','MAD')),
	CONSTRAINT "purchase_rounding_valid" CHECK ("purchase_awards"."rounding" = 'floor')
);
--> statement-breakpoint
ALTER TABLE "programs" DROP CONSTRAINT "program_points_positive";--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "earning_mode" varchar(8) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "rewards" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "program_rule_versions" ADD CONSTRAINT "program_rule_versions_tenant_id_program_id_programs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."programs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_awards" ADD CONSTRAINT "purchase_awards_tenant_id_ledger_entry_id_ledger_entries_tenant_id_id_fk" FOREIGN KEY ("tenant_id","ledger_entry_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_awards" ADD CONSTRAINT "purchase_awards_tenant_id_rule_version_id_program_rule_versions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","rule_version_id") REFERENCES "public"."program_rule_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "program_earning_mode_valid" CHECK ("programs"."earning_mode" in ('manual','purchase'));--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "program_points_positive" CHECK ("programs"."points_per_euro" between 1 and 1000);--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "reward_sort_order_nonnegative" CHECK ("rewards"."sort_order" >= 0);--> statement-breakpoint
-- Old programmes retain manual earning; do not reinterpret historical point awards as purchases.
INSERT INTO "program_rule_versions" ("tenant_id", "program_id", "version", "name", "type", "rules_text", "earning_mode", "points_per_currency_unit", "effective_at")
SELECT "tenant_id", "id", 1, "name", "type", "rules_text", "earning_mode", "points_per_euro", "effective_at" FROM "programs";--> statement-breakpoint
WITH numbered AS (
  SELECT "id", row_number() OVER (PARTITION BY "program_id" ORDER BY "created_at", "id") - 1 AS position
  FROM "rewards"
)
UPDATE "rewards" SET "sort_order" = numbered.position FROM numbered WHERE "rewards"."id" = numbered."id";--> statement-breakpoint
CREATE FUNCTION reject_programme_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Programme audit rows are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER program_rule_versions_append_only BEFORE UPDATE OR DELETE ON "program_rule_versions" FOR EACH ROW EXECUTE FUNCTION reject_programme_audit_mutation();--> statement-breakpoint
CREATE TRIGGER purchase_awards_append_only BEFORE UPDATE OR DELETE ON "purchase_awards" FOR EACH ROW EXECUTE FUNCTION reject_programme_audit_mutation();
