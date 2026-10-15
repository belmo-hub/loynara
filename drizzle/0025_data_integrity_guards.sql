-- Checks are added NOT VALID: they apply to every new or changed row from now on, and the deploy does not scan the
-- existing rows to validate them (those were written by code that already follows the same rules). Each ALTER still
-- takes a short ACCESS EXCLUSIVE lock on its table, held until the migration commits. The migrate service's
-- lock_timeout (15 s) applies to each lock it waits for; locks already taken stay until commit or rollback.
ALTER TABLE "automation_rules" DROP CONSTRAINT "automation_rule_inactivity_valid";--> statement-breakpoint
ALTER TABLE "locations" DROP CONSTRAINT "location_coordinates_valid";--> statement-breakpoint
ALTER TABLE "consent_events" ALTER COLUMN "created_at" SET DEFAULT clock_timestamp();--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rule_inactivity_valid" CHECK (("automation_rules"."trigger_kind" in ('first_checkout','reward_ready') and "automation_rules"."inactivity_days" is null) or ("automation_rules"."trigger_kind" = 'inactive' and "automation_rules"."inactivity_days" is not null and "automation_rules"."inactivity_days" between 7 and 365)) NOT VALID;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_kind_sign_valid" CHECK (("ledger_entries"."kind" = 'award' and "ledger_entries"."delta" > 0) or ("ledger_entries"."kind" = 'redeem' and "ledger_entries"."delta" < 0) or "ledger_entries"."kind" = 'reversal') NOT VALID;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_reversal_link_valid" CHECK (("ledger_entries"."kind" = 'reversal') = ("ledger_entries"."reversal_of_id" is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "location_coordinates_valid" CHECK (("locations"."latitude" is null and "locations"."longitude" is null) or ("locations"."latitude" is not null and "locations"."longitude" is not null and "locations"."latitude" between -90 and 90 and "locations"."longitude" between -180 and 180)) NOT VALID;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemption_cost_positive" CHECK ("redemptions"."cost" > 0) NOT VALID;--> statement-breakpoint
CREATE FUNCTION reject_reward_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Reward versions and redemptions are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER reward_versions_append_only BEFORE UPDATE OR DELETE ON "reward_versions" FOR EACH ROW EXECUTE FUNCTION reject_reward_history_mutation();--> statement-breakpoint
CREATE TRIGGER redemptions_append_only BEFORE UPDATE OR DELETE ON "redemptions" FOR EACH ROW EXECUTE FUNCTION reject_reward_history_mutation();
