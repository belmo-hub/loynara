-- Catalogue-based reminder only; existing rules and enabled=false default stay unchanged.
ALTER TABLE "automation_rules" DROP CONSTRAINT "automation_rule_trigger_valid";
--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rule_trigger_valid" CHECK ("trigger_kind" in ('first_checkout','inactive','reward_ready'));
--> statement-breakpoint
ALTER TABLE "automation_rules" DROP CONSTRAINT "automation_rule_inactivity_valid";
--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rule_inactivity_valid" CHECK (("trigger_kind" in ('first_checkout','reward_ready') and "inactivity_days" is null) or ("trigger_kind" = 'inactive' and "inactivity_days" between 7 and 365));
