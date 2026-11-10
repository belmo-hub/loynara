-- ENG-100: changes to customers' disadvantage take effect four weeks after saving. A reward archive becomes a date
-- (rewards.ends_at; the reward stays redeemable until then), and rule versions get columns for the points expiry that
-- applies with them. All nullable, nothing backfilled: no reward is ending and no version records an expiry yet.
ALTER TABLE "program_rule_versions" ADD COLUMN "points_expiry_months" integer;--> statement-breakpoint
ALTER TABLE "program_rule_versions" ADD COLUMN "points_expiry_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rewards" ADD COLUMN "ends_at" timestamp with time zone;